import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";
import { DEPARTAMENTOS } from "@/components/office/office-config";
import {
  montarEspelho,
  sufixoVirada,
  type EspelhoPayload,
  type EspelhoData,
  type CategoriaRegra,
} from "@/lib/espelho-ponto";
import {
  calcularJornadaPeriodo,
  rowToJornada,
  situacaoDia,
  type JornadaPadrao,
  type CalcPeriodo,
  type Feriado,
} from "@/lib/jornada-padrao";
import { gerarEspelhoPDF } from "@/lib/espelho-pdf";
import { formatDate, formatDuration, formatHM, AJUSTE_TIPO_LABEL } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Users, Clock } from "lucide-react";
import { toast } from "sonner";

// Acesso por papel: a página é acessível a qualquer autenticado (o pai
// `_authenticated` já garante login). A RPC `espelho_ponto` é a trava real —
// superadmin vê todos, admin vê a própria área (same_area), usuário vê só a si.
export const Route = createFileRoute("/_authenticated/espelho-ponto")({
  head: () => ({ meta: [{ title: "Espelho de Ponto" }] }),
  component: EspelhoPontoPage,
});

type Perfil = {
  id: string;
  nome: string | null;
  cargo: string | null;
  departamento: string | null;
  email: string | null;
  ativo: boolean | null;
};

// Um colaborador pertence ao setor quando o `departamento` (livre) bate com o
// value canônico OU o label do setor (case-insensitive) — tolerante à forma salva.
function pertenceAoSetor(dep: string | null, setor: { value: string; label: string }): boolean {
  const d = (dep ?? "").trim().toLowerCase();
  if (!d) return false;
  return d === setor.value.toLowerCase() || d === setor.label.toLowerCase();
}

function EspelhoPontoPage() {
  const { user, profile, isAdmin, isSuperadmin, loading: authLoading } = useAuth();
  // admin "puro" = gerente de área (não superadmin): escopo limitado ao próprio setor.
  const adminPuro = isAdmin && !isSuperadmin;
  const myDept = (profile?.departamento ?? "").trim().toLowerCase();

  const today = new Date();
  const ago = new Date();
  ago.setDate(today.getDate() - 30);

  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [regras, setRegras] = useState<CategoriaRegra[]>([]);
  const [setor, setSetor] = useState<string>("all");
  const [usuarioId, setUsuarioId] = useState<string>("");
  const [de, setDe] = useState(ago.toISOString().slice(0, 10));
  const [ate, setAte] = useState(today.toISOString().slice(0, 10));
  const [preview, setPreview] = useState<EspelhoData | null>(null);
  const [previewUid, setPreviewUid] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Jornada padrão (apuração liberada para admin+superadmin): modelos, vínculos e feriados.
  // Leituras tolerantes a tabelas inexistentes (pré-deploy): erro → lista vazia.
  const [modelos, setModelos] = useState<Tables<"jornada_padrao">[]>([]);
  const [vinculos, setVinculos] = useState<{ usuario_id: string; jornada_padrao_id: string }[]>([]);
  const [feriados, setFeriados] = useState<Feriado[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from("jornada_padrao")
      .select("*")
      .then(({ data }) => setModelos((data ?? []) as Tables<"jornada_padrao">[]));
    supabase
      .from("jornada_usuario")
      .select("usuario_id, jornada_padrao_id")
      .then(({ data }) =>
        setVinculos((data ?? []) as { usuario_id: string; jornada_padrao_id: string }[]),
      );
    supabase
      .from("feriados")
      .select("data, ativo")
      .then(({ data }) =>
        setFeriados(
          ((data ?? []) as { data: string; ativo: boolean }[])
            .filter((f) => f.ativo)
            .map((f) => ({ data: f.data })),
        ),
      );
  }, [isAdmin]);

  const modeloById = useMemo(() => new Map(modelos.map((m) => [m.id, m])), [modelos]);
  const vinculoMap = useMemo(
    () => new Map(vinculos.map((v) => [v.usuario_id, v.jornada_padrao_id])),
    [vinculos],
  );
  const modeloPadrao = useMemo(() => modelos.find((m) => m.padrao_sistema), [modelos]);

  // Resolve a jornada efetiva do colaborador: vínculo → modelo; senão padrão do sistema.
  const resolverJornada = useCallback(
    (uid: string): JornadaPadrao | null => {
      const id = vinculoMap.get(uid);
      const row = (id && modeloById.get(id)) || modeloPadrao;
      return row ? rowToJornada(row) : null;
    },
    [vinculoMap, modeloById, modeloPadrao],
  );

  const calcDe = useCallback(
    (e: EspelhoData, uid: string): CalcPeriodo | null => {
      if (!isAdmin) return null;
      const j = resolverJornada(uid);
      if (!j) return null;
      return calcularJornadaPeriodo(e.dias, e.periodo.de, e.periodo.ate, j, feriados);
    },
    [isAdmin, resolverJornada, feriados],
  );

  // Cálculo do preview na tela (do colaborador efetivamente visualizado).
  const calc = useMemo(
    () => (preview && previewUid ? calcDe(preview, previewUid) : null),
    [preview, previewUid, calcDe],
  );

  // Regras de categoria ativas (paridade com o dashboard) — para todos os papéis.
  useEffect(() => {
    supabase
      .from("categoria_atividade")
      .select("tipo, identificador, categoria, produtiva, ativo")
      .then(({ data }) =>
        setRegras(((data ?? []) as (CategoriaRegra & { ativo: boolean })[]).filter((r) => r.ativo)),
      );
  }, []);

  // Lista de colaboradores só importa para admin/superadmin (usuário vê só a si).
  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from("profiles")
      .select("id, nome, cargo, departamento, email, ativo")
      .order("nome")
      .then(({ data }) => setPerfis(((data ?? []) as Perfil[]).filter((p) => p.ativo !== false)));
  }, [isAdmin]);

  // Usuário comum: alvo fixo é ele mesmo.
  useEffect(() => {
    if (!authLoading && !isAdmin && user) setUsuarioId(user.id);
  }, [authLoading, isAdmin, user]);

  // Universo visível por papel: superadmin = todos; admin = própria área; user = só ele.
  const baseUsers = useMemo(() => {
    if (isSuperadmin) return perfis;
    if (adminPuro) {
      if (!myDept) return user ? perfis.filter((p) => p.id === user.id) : [];
      return perfis.filter((p) => (p.departamento ?? "").trim().toLowerCase() === myDept);
    }
    return [];
  }, [isSuperadmin, adminPuro, perfis, myDept, user]);

  // Superadmin pode refinar por setor; admin já está restrito à própria área.
  const usuariosDoSetor = useMemo(() => {
    if (!isSuperadmin || setor === "all") return baseUsers;
    const s = DEPARTAMENTOS.find((d) => d.value === setor);
    if (!s) return baseUsers;
    return baseUsers.filter((p) => pertenceAoSetor(p.departamento, s));
  }, [isSuperadmin, baseUsers, setor]);

  // Mantém a seleção válida quando o setor/escopo muda (só p/ admin+).
  useEffect(() => {
    if (isAdmin && usuarioId && !usuariosDoSetor.some((u) => u.id === usuarioId)) setUsuarioId("");
  }, [isAdmin, usuariosDoSetor, usuarioId]);

  const carregarEspelho = async (uid: string): Promise<EspelhoData | null> => {
    const { data, error } = await supabase.rpc("espelho_ponto", {
      p_usuario: uid,
      p_de: de,
      p_ate: ate,
    });
    if (error) {
      toast.error("Falha ao carregar espelho", { description: error.message });
      return null;
    }
    return montarEspelho(data as unknown as EspelhoPayload, de, ate, regras);
  };

  const visualizar = async () => {
    if (!usuarioId) return toast.error("Selecione um colaborador.");
    setLoading(true);
    const e = await carregarEspelho(usuarioId);
    setLoading(false);
    if (e) {
      setPreview(e);
      setPreviewUid(usuarioId);
    }
  };

  const exportarIndividual = async () => {
    if (!usuarioId) return toast.error("Selecione um colaborador.");
    setExporting(true);
    const e = preview && previewMatchesSelection() ? preview : await carregarEspelho(usuarioId);
    setExporting(false);
    if (!e) return;
    const nome = (e.perfil?.nome ?? "colaborador").replace(/\s+/g, "-").toLowerCase();
    gerarEspelhoPDF([e], `espelho-${nome}-${de}-a-${ate}.pdf`, [calcDe(e, usuarioId)]);
  };

  const exportarSetor = async () => {
    const alvos = usuariosDoSetor;
    if (alvos.length === 0) return toast.error("Nenhum colaborador no setor.");
    setExporting(true);
    const espelhos: EspelhoData[] = [];
    const calculos: (CalcPeriodo | null)[] = [];
    for (let i = 0; i < alvos.length; i++) {
      toast.message(`Gerando ${i + 1}/${alvos.length}…`, { description: alvos[i].nome ?? "" });
      const e = await carregarEspelho(alvos[i].id);
      if (e) {
        espelhos.push(e);
        calculos.push(calcDe(e, alvos[i].id));
      }
    }
    setExporting(false);
    if (espelhos.length === 0) return;
    const nomeSetor = adminPuro
      ? myDept || "minha-equipe"
      : setor === "all"
        ? "todos"
        : (DEPARTAMENTOS.find((d) => d.value === setor)?.value ?? setor);
    gerarEspelhoPDF(espelhos, `espelho-setor-${nomeSetor}-${de}-a-${ate}.pdf`, calculos);
    toast.success(`PDF gerado com ${espelhos.length} colaborador(es).`);
  };

  // Confere se o preview na tela corresponde à seleção/datas atuais.
  const previewMatchesSelection = () =>
    !!preview &&
    preview.periodo.de === de &&
    preview.periodo.ate === ate &&
    perfis.find((p) => p.id === usuarioId)?.nome === (preview.perfil?.nome ?? null);

  const k = preview?.kpis;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText className="h-6 w-6" /> Espelho de Ponto
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSuperadmin
            ? "Folha de frequência de qualquer colaborador, com marcações, KPIs do período e abonos/edições."
            : adminPuro
              ? "Folha de frequência da sua equipe (mesmo setor), com marcações, KPIs do período e abonos/edições."
              : "Seu espelho de ponto: marcações, KPIs do período e abonos/edições."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          {isSuperadmin && (
            <div className="space-y-2">
              <Label>Setor</Label>
              <Select value={setor} onValueChange={setSetor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os setores</SelectItem>
                  {DEPARTAMENTOS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isAdmin && (
            <div className="space-y-2">
              <Label>Colaborador</Label>
              <Select value={usuarioId} onValueChange={setUsuarioId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {usuariosDoSetor.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome ?? u.email ?? u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!isAdmin && (
            <div className="space-y-2">
              <Label>Colaborador</Label>
              <Input value={profile?.nome ?? user?.email ?? "Você"} disabled readOnly />
            </div>
          )}
          <div className="space-y-2">
            <Label>De</Label>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Até</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={visualizar} disabled={loading || !usuarioId} className="w-full">
              {loading ? "Carregando…" : "Visualizar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportarIndividual} disabled={exporting || !usuarioId}>
          <FileText className="mr-2 h-4 w-4" />
          {isAdmin ? "Exportar PDF (colaborador)" : "Exportar meu espelho"}
        </Button>
        {isAdmin && (
          <Button variant="outline" onClick={exportarSetor} disabled={exporting}>
            <Users className="mr-2 h-4 w-4" />
            {exporting
              ? "Gerando…"
              : adminPuro
                ? `Exportar toda a minha equipe (${usuariosDoSetor.length})`
                : `Exportar todos ${setor === "all" ? "(todos os setores)" : "do setor"} (${usuariosDoSetor.length})`}
          </Button>
        )}
      </div>

      {/* ---- Preview ---- */}
      {preview && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {preview.perfil?.nome ?? "—"}
                {preview.perfil?.departamento ? ` · ${preview.perfil.departamento}` : ""}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {formatDate(preview.periodo.de)} a {formatDate(preview.periodo.ate)} ·{" "}
                {k?.diasComRegistro ?? 0} dia(s) com registro
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {k &&
                  (
                    [
                      ["Tempo ativo", formatDuration(k.ativoMin)],
                      ["Ociosidade", formatDuration(k.ocioMin)],
                      ["Efetivo", formatDuration(k.efetivoMin)],
                      ["Produtividade", `${k.produtividade.toFixed(0)}%`],
                      ["Pausa", formatDuration(k.pausaMin)],
                      ["Almoço", formatDuration(k.almocoMin)],
                      ["Inativo", formatDuration(k.inativoMin)],
                      ["Abonado", formatDuration(k.abonoMin)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-lg font-semibold">{value}</div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Apuração de jornada (vs horário padrão) — só superadmin por ora. */}
          {calc && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4" /> Apuração de jornada
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Previsto vs. realizado (marcações). Saldo, HE, pendentes, faltas e adicional
                  noturno.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["Previsto", formatDuration(calc.totais.previstoMin)],
                      ["Realizado", formatDuration(calc.totais.realizadoMin)],
                      [
                        "Saldo",
                        `${calc.totais.saldoMin < 0 ? "−" : "+"}${formatDuration(Math.abs(calc.totais.saldoMin))}`,
                      ],
                      ["Horas extras", formatDuration(calc.totais.extraMin)],
                      ["Pendentes", formatDuration(calc.totais.pendenteMin)],
                      ["Faltas", `${calc.totais.faltas} dia(s)`],
                      ["Noturno", formatDuration(calc.totais.noturnoMin)],
                      ["Feriados trab.", `${calc.totais.feriadosTrabalhados}`],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-lg font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />{" "}
                {calc
                  ? `Apuração diária (${calc.linhas.length})`
                  : `Registro diário (${preview.dias.length})`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                {calc ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dia</TableHead>
                        <TableHead>Entrada</TableHead>
                        <TableHead>S. Almoço</TableHead>
                        <TableHead>V. Almoço</TableHead>
                        <TableHead>Saída</TableHead>
                        <TableHead>Previsto</TableHead>
                        <TableHead>Realizado</TableHead>
                        <TableHead>Ocioso</TableHead>
                        <TableHead>Saldo</TableHead>
                        <TableHead>Noturno</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calc.linhas.map((d) => {
                        const c = d.calc;
                        return (
                          <TableRow
                            key={d.dia}
                            className={
                              c.falta ? "bg-destructive/5" : d.editado ? "bg-primary/5" : undefined
                            }
                          >
                            <TableCell>{formatDate(d.dia)}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {d.marcacoes.entrada ? formatHM(d.marcacoes.entrada) : "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {d.marcacoes.almocoInicio ? formatHM(d.marcacoes.almocoInicio) : "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {d.marcacoes.almocoFim ? formatHM(d.marcacoes.almocoFim) : "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {d.marcacoes.saida
                                ? formatHM(d.marcacoes.saida) +
                                  sufixoVirada(d.marcacoes.saida, d.dia)
                                : c.aberto
                                  ? "em andamento"
                                  : "—"}
                            </TableCell>
                            <TableCell>
                              {c.previstoMin ? formatDuration(c.previstoMin) : "—"}
                            </TableCell>
                            <TableCell>
                              {c.realizadoMin ? formatDuration(c.realizadoMin) : "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {d.ocioMin ? formatDuration(d.ocioMin) : "—"}
                            </TableCell>
                            <TableCell
                              className={
                                c.saldoMin < 0
                                  ? "text-destructive"
                                  : c.saldoMin > 0
                                    ? "text-success"
                                    : undefined
                              }
                            >
                              {c.realizadoMin || c.previstoMin
                                ? `${c.saldoMin < 0 ? "−" : "+"}${formatDuration(Math.abs(c.saldoMin))}`
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {c.noturnoMin ? formatDuration(c.noturnoMin) : "—"}
                            </TableCell>
                            <TableCell className="text-xs">{situacaoDia(c)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dia</TableHead>
                        <TableHead>Entrada</TableHead>
                        <TableHead>Saída Almoço</TableHead>
                        <TableHead>Volta Almoço</TableHead>
                        <TableHead>Saída</TableHead>
                        <TableHead>Trabalhado</TableHead>
                        <TableHead>Obs.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.dias.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground">
                            Nenhum registro no período.
                          </TableCell>
                        </TableRow>
                      ) : (
                        preview.dias.map((d) => {
                          const obs: string[] = [];
                          if (d.tiposAjuste.length)
                            obs.push(
                              d.tiposAjuste.map((t) => AJUSTE_TIPO_LABEL[t] ?? t).join(", "),
                            );
                          if (d.marcacoes.extras.length)
                            obs.push(`+${d.marcacoes.extras.length} interv.`);
                          if (d.ocioMin > 0) obs.push(`ócio ${formatDuration(d.ocioMin)}`);
                          return (
                            <TableRow
                              key={d.dia}
                              className={d.editado ? "bg-primary/5" : undefined}
                            >
                              <TableCell>{formatDate(d.dia)}</TableCell>
                              <TableCell className="font-mono text-xs">
                                {d.marcacoes.entrada ? formatHM(d.marcacoes.entrada) : "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {d.marcacoes.almocoInicio
                                  ? formatHM(d.marcacoes.almocoInicio)
                                  : "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {d.marcacoes.almocoFim ? formatHM(d.marcacoes.almocoFim) : "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {d.marcacoes.saida
                                  ? formatHM(d.marcacoes.saida) +
                                    sufixoVirada(d.marcacoes.saida, d.dia)
                                  : "em andamento"}
                              </TableCell>
                              <TableCell>{formatDuration(d.ativoMin)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {obs.join(" · ")}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
