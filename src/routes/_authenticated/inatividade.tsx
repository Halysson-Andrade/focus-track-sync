import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEPARTAMENTOS } from "@/components/office/office-config";
import {
  montarRelatorio,
  type InatividadePayload,
  type RelatorioInatividade,
} from "@/lib/relatorio-inatividade";
import { gerarInatividadePDF } from "@/lib/inatividade-pdf";
import { JUSTIFICATIVA_STATUS_LABEL } from "@/lib/justificativas-ocio";
import { formatDate, formatDuration, formatHM } from "@/lib/format";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Gauge, FileText, Users, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/inatividade")({
  head: () => ({ meta: [{ title: "Relatório de Inatividade" }] }),
  // Porteiro por getSession() (localStorage, sem rede) — o gate forte é o pai
  // _authenticated/route.tsx. Gestores: admin, superadmin ou flag espelho_geral.
  // A trava REAL de dados é a RPC relatorio_inatividade (SECURITY DEFINER).
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) throw redirect({ to: "/auth" });
    const [{ data: roles }, { data: prof }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", session.user.id),
      supabase.from("profiles").select("espelho_geral").eq("id", session.user.id).maybeSingle(),
    ]);
    const gestor =
      !!roles?.some((r) => r.role === "admin" || r.role === "superadmin") || !!prof?.espelho_geral;
    if (!gestor) throw redirect({ to: "/" });
  },
  component: InatividadePage,
});

function InatividadePage() {
  const { isSuperadmin, profile } = useAuth();
  // Quem enxerga todos os setores (com filtro por setor). Admin "puro" já vem
  // restrito à própria área pela RPC — não mostra o seletor de setor.
  const verTodos = isSuperadmin || !!profile?.espelho_geral;

  const today = new Date();
  const ago = new Date();
  ago.setDate(today.getDate() - 30);

  const [setor, setSetor] = useState<string>("all");
  const [de, setDe] = useState(ago.toISOString().slice(0, 10));
  const [ate, setAte] = useState(today.toISOString().slice(0, 10));
  const [payload, setPayload] = useState<InatividadePayload | null>(null);
  const [loading, setLoading] = useState(false);

  // Setor filtrado no cliente (não refaz o fetch). nowTs congelado na derivação.
  const rel: RelatorioInatividade | null = useMemo(
    () => (payload ? montarRelatorio(payload, verTodos ? setor : "all", Date.now()) : null),
    [payload, setor, verTodos],
  );

  const setorLabelAtual =
    !verTodos || setor === "all"
      ? "Todos os setores"
      : (DEPARTAMENTOS.find((d) => d.value === setor)?.label ?? setor);

  function preset(dias: number) {
    const fim = new Date();
    const ini = new Date();
    if (dias > 0) ini.setDate(fim.getDate() - dias);
    setDe(ini.toISOString().slice(0, 10));
    setAte(fim.toISOString().slice(0, 10));
  }

  async function gerar() {
    if (ate < de) {
      toast.error("Período inválido", { description: "A data final deve ser ≥ inicial." });
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("relatorio_inatividade", { p_de: de, p_ate: ate });
    setLoading(false);
    if (error) {
      toast.error("Falha ao gerar relatório", { description: error.message });
      return;
    }
    setPayload(data as unknown as InatividadePayload);
  }

  function exportarPDF() {
    if (!rel) return;
    gerarInatividadePDF(
      rel,
      { de, ate, setorLabel: setorLabelAtual },
      `relatorio-inatividade-${de}-a-${ate}.pdf`,
    );
  }

  const maxOcio = rel?.colaboradores[0]?.ocioMin ?? 0;
  const pctTotal = rel && rel.totalAtivoMin > 0 ? (rel.totalOcioMin / rel.totalAtivoMin) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Gauge className="h-6 w-6" /> Relatório de Inatividade
        </h1>
        <p className="text-sm text-muted-foreground">
          Ranking de ociosidade (ócio detectado dentro do tempo ativo) por setor e por colaborador,
          no período escolhido.
        </p>
      </div>

      {/* ---- Filtros ---- */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-5">
          {verTodos && (
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
          <div className="space-y-2">
            <Label>De</Label>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Até</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Atalhos</Label>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => preset(0)}>
                Hoje
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => preset(7)}>
                7 dias
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => preset(30)}>
                30 dias
              </Button>
            </div>
          </div>
          <div className="flex items-end">
            <Button onClick={gerar} disabled={loading} className="w-full">
              {loading ? "Carregando…" : "Gerar relatório"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {rel && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportarPDF} disabled={!rel.totalColaboradores}>
              <FileText className="mr-2 h-4 w-4" /> Exportar PDF
            </Button>
          </div>

          {/* ---- KPIs ---- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ["Ociosidade total", formatDuration(rel.totalOcioMin)],
                ["Ócio justificado", formatDuration(rel.totalOcioJustificadoMin)],
                ["Tempo ativo total", formatDuration(rel.totalAtivoMin)],
                ["% ócio", `${pctTotal.toFixed(0)}%`],
                ["Colaboradores", String(rel.totalColaboradores)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>

          <Tabs defaultValue="ranking" className="space-y-4">
            <TabsList>
              <TabsTrigger value="ranking">Ranking</TabsTrigger>
              <TabsTrigger value="justificativas">
                Justificativas ({rel.justificativas.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ranking" className="space-y-6">
              {/* ---- Ranking por setor ---- */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4" /> Ranking por setor
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {rel.setores.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Sem dados no período.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead className="text-right">Colab.</TableHead>
                          <TableHead className="text-right">Ócio</TableHead>
                          <TableHead className="text-right">Tempo ativo</TableHead>
                          <TableHead className="text-right">% ócio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rel.setores.map((s, i) => (
                          <TableRow key={s.setorLabel}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{s.setorLabel}</TableCell>
                            <TableCell className="text-right">{s.colaboradores}</TableCell>
                            <TableCell className="text-right">
                              {formatDuration(s.ocioMin)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatDuration(s.ativoMin)}
                            </TableCell>
                            <TableCell className="text-right">{s.pctOcio.toFixed(0)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* ---- Ranking por colaborador ---- */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Ranking por colaborador</CardTitle>
                </CardHeader>
                <CardContent>
                  {rel.colaboradores.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Sem dados no período.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Colaborador</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead className="text-right">Ócio</TableHead>
                          <TableHead className="text-right">Tempo ativo</TableHead>
                          <TableHead className="text-right">% ócio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rel.colaboradores.map((c, i) => (
                          <TableRow key={c.usuarioId}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">
                              <div>{c.nome}</div>
                              <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-primary"
                                  style={{
                                    width: `${maxOcio > 0 ? (c.ocioMin / maxOcio) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{c.setorLabel}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatDuration(c.ocioMin)}
                              {c.ocioJustificadoMin > 0 && (
                                <div
                                  className="text-xs font-normal text-muted-foreground"
                                  title={`Ócio bruto ${formatDuration(c.ocioBrutoMin)}; ${formatDuration(c.ocioJustificadoMin)} justificado e aprovado`}
                                >
                                  −{formatDuration(c.ocioJustificadoMin)} justificado
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatDuration(c.ativoMin)}
                            </TableCell>
                            <TableCell className="text-right">{c.pctOcio.toFixed(0)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- Justificativas de ociosidade ---- */}
            <TabsContent value="justificativas">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4" /> Justificativas de ociosidade
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {rel.justificativas.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nenhuma justificativa de ociosidade no período.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Dia</TableHead>
                            <TableHead>Colaborador</TableHead>
                            <TableHead>Setor</TableHead>
                            <TableHead>Período</TableHead>
                            <TableHead className="text-right">Duração</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Justificativa</TableHead>
                            <TableHead>Decisão</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rel.justificativas.map((j) => {
                            const decisao = [
                              j.justificativaDecisao ?? "",
                              j.decididoPorNome ? `(${j.decididoPorNome})` : "",
                            ]
                              .filter(Boolean)
                              .join(" ");
                            return (
                              <TableRow key={j.id}>
                                <TableCell>{formatDate(j.dia)}</TableCell>
                                <TableCell className="font-medium">{j.nome}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {j.setorLabel}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {formatHM(j.inicio)}–{formatHM(j.fim)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatDuration(j.duracaoMin)}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      j.status === "aprovada"
                                        ? "default"
                                        : j.status === "rejeitada"
                                          ? "destructive"
                                          : "secondary"
                                    }
                                    className="font-normal"
                                  >
                                    {JUSTIFICATIVA_STATUS_LABEL[j.status] ?? j.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="max-w-[22rem] text-xs">
                                  {j.justificativa}
                                </TableCell>
                                <TableCell className="max-w-[16rem] text-xs text-muted-foreground">
                                  {decisao || "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {!rel && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Escolha o período e clique em <span className="font-medium">Gerar relatório</span>.
        </p>
      )}
    </div>
  );
}
