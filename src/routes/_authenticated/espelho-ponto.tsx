import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEPARTAMENTOS } from "@/components/office/office-config";
import {
  montarEspelho,
  type EspelhoPayload,
  type EspelhoData,
  type CategoriaRegra,
} from "@/lib/espelho-ponto";
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

export const Route = createFileRoute("/_authenticated/espelho-ponto")({
  head: () => ({ meta: [{ title: "Espelho de Ponto" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isSuperadmin = !!roles?.some((r) => r.role === "superadmin");
    if (!isSuperadmin) throw redirect({ to: "/" });
  },
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
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Colaboradores ativos + regras de categoria ativas (paridade com o dashboard).
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, nome, cargo, departamento, email, ativo")
      .order("nome")
      .then(({ data }) => setPerfis(((data ?? []) as Perfil[]).filter((p) => p.ativo !== false)));
    supabase
      .from("categoria_atividade")
      .select("tipo, identificador, categoria, produtiva, ativo")
      .then(({ data }) =>
        setRegras(((data ?? []) as (CategoriaRegra & { ativo: boolean })[]).filter((r) => r.ativo)),
      );
  }, []);

  const usuariosDoSetor = useMemo(() => {
    if (setor === "all") return perfis;
    const s = DEPARTAMENTOS.find((d) => d.value === setor);
    if (!s) return perfis;
    return perfis.filter((p) => pertenceAoSetor(p.departamento, s));
  }, [perfis, setor]);

  // Mantém a seleção válida quando o setor muda.
  useEffect(() => {
    if (usuarioId && !usuariosDoSetor.some((u) => u.id === usuarioId)) setUsuarioId("");
  }, [usuariosDoSetor, usuarioId]);

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
    if (e) setPreview(e);
  };

  const exportarIndividual = async () => {
    if (!usuarioId) return toast.error("Selecione um colaborador.");
    setExporting(true);
    const e = preview && previewMatchesSelection() ? preview : await carregarEspelho(usuarioId);
    setExporting(false);
    if (!e) return;
    const nome = (e.perfil?.nome ?? "colaborador").replace(/\s+/g, "-").toLowerCase();
    gerarEspelhoPDF([e], `espelho-${nome}-${de}-a-${ate}.pdf`);
  };

  const exportarSetor = async () => {
    const alvos = usuariosDoSetor;
    if (alvos.length === 0) return toast.error("Nenhum colaborador no setor.");
    setExporting(true);
    const espelhos: EspelhoData[] = [];
    for (let i = 0; i < alvos.length; i++) {
      toast.message(`Gerando ${i + 1}/${alvos.length}…`, { description: alvos[i].nome ?? "" });
      const e = await carregarEspelho(alvos[i].id);
      if (e) espelhos.push(e);
    }
    setExporting(false);
    if (espelhos.length === 0) return;
    const nomeSetor =
      setor === "all" ? "todos" : (DEPARTAMENTOS.find((d) => d.value === setor)?.value ?? setor);
    gerarEspelhoPDF(espelhos, `espelho-setor-${nomeSetor}-${de}-a-${ate}.pdf`);
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
          Folha de frequência por colaborador com marcações, KPIs do período e abonos/edições.
          Exportação restrita ao superadmin.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
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
          Exportar PDF (colaborador)
        </Button>
        <Button variant="outline" onClick={exportarSetor} disabled={exporting}>
          <Users className="mr-2 h-4 w-4" />
          {exporting
            ? "Gerando…"
            : `Exportar todos ${setor === "all" ? "(todos os setores)" : "do setor"} (${usuariosDoSetor.length})`}
        </Button>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" /> Registro diário ({preview.dias.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
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
                          obs.push(d.tiposAjuste.map((t) => AJUSTE_TIPO_LABEL[t] ?? t).join(", "));
                        if (d.marcacoes.extras.length)
                          obs.push(`+${d.marcacoes.extras.length} interv.`);
                        if (d.ocioMin > 0) obs.push(`ócio ${formatDuration(d.ocioMin)}`);
                        return (
                          <TableRow key={d.dia} className={d.editado ? "bg-primary/5" : undefined}>
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
                              {d.marcacoes.saida ? formatHM(d.marcacoes.saida) : "em andamento"}
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
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
