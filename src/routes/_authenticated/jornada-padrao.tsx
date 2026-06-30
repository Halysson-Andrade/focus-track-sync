import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { previstoTrabalhoMin, type DiaTipo } from "@/lib/jornada-padrao";
import { formatDuration, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, Plus, Pencil, Trash2, Star, CalendarDays } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/jornada-padrao")({
  head: () => ({ meta: [{ title: "Horário Padrão" }] }),
  component: JornadaPadraoPage,
});

type ModeloRow = Tables<"jornada_padrao">;
type FeriadoRow = Tables<"feriados">;
type VinculoRow = Tables<"jornada_usuario">;
type PerfilLite = {
  id: string;
  nome: string | null;
  departamento: string | null;
  email: string | null;
};

const DIAS = [
  { key: "dia_dom", label: "Dom" },
  { key: "dia_seg", label: "Seg" },
  { key: "dia_ter", label: "Ter" },
  { key: "dia_qua", label: "Qua" },
  { key: "dia_qui", label: "Qui" },
  { key: "dia_sex", label: "Sex" },
  { key: "dia_sab", label: "Sáb" },
] as const;

const TIPO_OPCOES: { value: DiaTipo; label: string }[] = [
  { value: "trabalho", label: "Trabalho" },
  { value: "compensado", label: "Compensado" },
  { value: "dsr", label: "DSR" },
  { value: "folga", label: "Folga" },
];

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

type ModeloForm = {
  nome: string;
  hora_entrada: string;
  hora_almoco_inicio: string;
  hora_almoco_fim: string;
  hora_saida: string;
  tolerancia_min: number;
  dias: Record<(typeof DIAS)[number]["key"], DiaTipo>;
  padrao_sistema: boolean;
  ativo: boolean;
};

const FORM_VAZIO: ModeloForm = {
  nome: "",
  hora_entrada: "07:30",
  hora_almoco_inicio: "12:00",
  hora_almoco_fim: "13:30",
  hora_saida: "17:48",
  tolerancia_min: 15,
  dias: {
    dia_dom: "dsr",
    dia_seg: "trabalho",
    dia_ter: "trabalho",
    dia_qua: "trabalho",
    dia_qui: "trabalho",
    dia_sex: "trabalho",
    dia_sab: "compensado",
  },
  padrao_sistema: false,
  ativo: true,
};

function JornadaPadraoPage() {
  const { isSuperadmin, loading: authLoading } = useAuth();
  const router = useRouter();

  const [modelos, setModelos] = useState<ModeloRow[]>([]);
  const [feriados, setFeriados] = useState<FeriadoRow[]>([]);
  const [vinculos, setVinculos] = useState<VinculoRow[]>([]);
  const [perfis, setPerfis] = useState<PerfilLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Dialog de modelo (criar/editar).
  const [modeloDialog, setModeloDialog] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<ModeloForm>(FORM_VAZIO);

  // Form de feriado.
  const [feriadoData, setFeriadoData] = useState("");
  const [feriadoDesc, setFeriadoDesc] = useState("");

  // Guarda de acesso: somente superadmin.
  useEffect(() => {
    if (!authLoading && !isSuperadmin) router.navigate({ to: "/" });
  }, [authLoading, isSuperadmin, router]);

  const loadModelos = useCallback(async () => {
    const { data } = await supabase.from("jornada_padrao").select("*").order("nome");
    setModelos((data ?? []) as ModeloRow[]);
  }, []);
  const loadFeriados = useCallback(async () => {
    const { data } = await supabase.from("feriados").select("*").order("data");
    setFeriados((data ?? []) as FeriadoRow[]);
  }, []);
  const loadVinculos = useCallback(async () => {
    const { data } = await supabase.from("jornada_usuario").select("*");
    setVinculos((data ?? []) as VinculoRow[]);
  }, []);
  const loadPerfis = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome, departamento, email, ativo")
      .order("nome");
    setPerfis(
      ((data ?? []) as (PerfilLite & { ativo: boolean | null })[]).filter((p) => p.ativo !== false),
    );
  }, []);

  useEffect(() => {
    if (!isSuperadmin) return;
    setLoading(true);
    Promise.all([loadModelos(), loadFeriados(), loadVinculos(), loadPerfis()]).finally(() =>
      setLoading(false),
    );
  }, [isSuperadmin, loadModelos, loadFeriados, loadVinculos, loadPerfis]);

  const modeloPadrao = useMemo(() => modelos.find((m) => m.padrao_sistema), [modelos]);
  const vinculoDe = useMemo(
    () => new Map(vinculos.map((v) => [v.usuario_id, v.jornada_padrao_id])),
    [vinculos],
  );

  // ---- Modelos ----
  const abrirNovo = () => {
    setForm(FORM_VAZIO);
    setModeloDialog({ id: null });
  };
  const abrirEditar = (m: ModeloRow) => {
    setForm({
      nome: m.nome,
      hora_entrada: hhmm(m.hora_entrada),
      hora_almoco_inicio: hhmm(m.hora_almoco_inicio),
      hora_almoco_fim: hhmm(m.hora_almoco_fim),
      hora_saida: hhmm(m.hora_saida),
      tolerancia_min: m.tolerancia_min ?? 15,
      dias: {
        dia_dom: m.dia_dom,
        dia_seg: m.dia_seg,
        dia_ter: m.dia_ter,
        dia_qua: m.dia_qua,
        dia_qui: m.dia_qui,
        dia_sex: m.dia_sex,
        dia_sab: m.dia_sab,
      },
      padrao_sistema: m.padrao_sistema,
      ativo: m.ativo,
    });
    setModeloDialog({ id: m.id });
  };

  const salvarModelo = async () => {
    if (!form.nome.trim()) return toast.error("Informe o nome do modelo.");
    if (!form.hora_entrada || !form.hora_saida)
      return toast.error("Entrada e saída são obrigatórias.");
    setSalvando(true);
    // Só um padrão do sistema: limpa os demais antes de gravar este como padrão.
    if (form.padrao_sistema) {
      await supabase
        .from("jornada_padrao")
        .update({ padrao_sistema: false })
        .eq("padrao_sistema", true);
    }
    const payload = {
      nome: form.nome.trim(),
      hora_entrada: form.hora_entrada,
      hora_almoco_inicio: form.hora_almoco_inicio || null,
      hora_almoco_fim: form.hora_almoco_fim || null,
      hora_saida: form.hora_saida,
      tolerancia_min: Number.isFinite(form.tolerancia_min) ? Math.max(0, form.tolerancia_min) : 15,
      ...form.dias,
      padrao_sistema: form.padrao_sistema,
      ativo: form.ativo,
    };
    const trySave = (p: typeof payload | Omit<typeof payload, "tolerancia_min">) =>
      modeloDialog?.id
        ? supabase.from("jornada_padrao").update(p).eq("id", modeloDialog.id)
        : supabase.from("jornada_padrao").insert(p);
    let { error } = await trySave(payload);
    // Pré-deploy: se a coluna `tolerancia_min` ainda não existe, salva sem ela
    // (o cálculo cai no default de 15min até a migration ir ao banco).
    if (error && (error.code === "PGRST204" || /tolerancia_min/i.test(error.message ?? ""))) {
      const semTol = { ...payload } as Partial<typeof payload>;
      delete semTol.tolerancia_min;
      ({ error } = await trySave(semTol as Omit<typeof payload, "tolerancia_min">));
    }
    setSalvando(false);
    if (error) return toast.error("Falha ao salvar", { description: error.message });
    setModeloDialog(null);
    await loadModelos();
    toast.success(modeloDialog?.id ? "Modelo atualizado." : "Modelo criado.");
  };

  const excluirModelo = async (m: ModeloRow) => {
    if (!confirm(`Excluir o modelo "${m.nome}"? Vínculos a ele também serão removidos.`)) return;
    const { error } = await supabase.from("jornada_padrao").delete().eq("id", m.id);
    if (error) return toast.error("Falha ao excluir", { description: error.message });
    await Promise.all([loadModelos(), loadVinculos()]);
    toast.success("Modelo excluído.");
  };

  // ---- Vínculos ----
  const vincular = async (usuarioId: string, jornadaId: string) => {
    if (jornadaId === "__default") {
      const { error } = await supabase.from("jornada_usuario").delete().eq("usuario_id", usuarioId);
      if (error) return toast.error("Falha ao remover vínculo", { description: error.message });
    } else {
      const { error } = await supabase.from("jornada_usuario").upsert({
        usuario_id: usuarioId,
        jornada_padrao_id: jornadaId,
        updated_at: new Date().toISOString(),
      });
      if (error) return toast.error("Falha ao vincular", { description: error.message });
    }
    await loadVinculos();
  };

  // ---- Feriados ----
  const addFeriado = async () => {
    if (!feriadoData) return toast.error("Informe a data do feriado.");
    setSalvando(true);
    const { error } = await supabase
      .from("feriados")
      .insert({ data: feriadoData, descricao: feriadoDesc.trim() });
    setSalvando(false);
    if (error) {
      const dup = error.code === "23505";
      return toast.error(dup ? "Já existe um feriado nessa data." : "Falha ao salvar", {
        description: dup ? undefined : error.message,
      });
    }
    setFeriadoData("");
    setFeriadoDesc("");
    await loadFeriados();
    toast.success("Feriado adicionado.");
  };
  const toggleFeriado = async (f: FeriadoRow) => {
    const { error } = await supabase.from("feriados").update({ ativo: !f.ativo }).eq("id", f.id);
    if (error) return toast.error("Falha ao atualizar", { description: error.message });
    await loadFeriados();
  };
  const excluirFeriado = async (f: FeriadoRow) => {
    const { error } = await supabase.from("feriados").delete().eq("id", f.id);
    if (error) return toast.error("Falha ao excluir", { description: error.message });
    await loadFeriados();
  };

  if (authLoading || !isSuperadmin) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Clock className="h-6 w-6" /> Horário Padrão
        </h1>
        <p className="text-sm text-muted-foreground">
          Modelos de jornada esperada (entrada/almoço/saída + tipo de cada dia), vínculo por
          colaborador e feriados. Base do cálculo de pendentes, HE e faltas no espelho de ponto.
        </p>
      </div>

      <Tabs defaultValue="modelos">
        <TabsList>
          <TabsTrigger value="modelos">Modelos ({modelos.length})</TabsTrigger>
          <TabsTrigger value="vinculos">Vínculos ({perfis.length})</TabsTrigger>
          <TabsTrigger value="feriados">Feriados ({feriados.length})</TabsTrigger>
        </TabsList>

        {/* ---------------- MODELOS ---------------- */}
        <TabsContent value="modelos" className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={abrirNovo}>
              <Plus className="mr-1.5 h-4 w-4" /> Novo modelo
            </Button>
          </div>
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : modelos.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhum modelo cadastrado.
            </p>
          ) : (
            modelos.map((m) => (
              <Card key={m.id} className={m.ativo ? "" : "opacity-60"}>
                <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 py-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {m.nome}
                    {m.padrao_sistema && (
                      <Badge className="gap-1">
                        <Star className="h-3 w-3" /> Padrão do sistema
                      </Badge>
                    )}
                    {!m.ativo && <Badge variant="secondary">Inativo</Badge>}
                  </CardTitle>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => abrirEditar(m)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => excluirModelo(m)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 py-0 pb-3 text-sm">
                  <div className="font-mono">
                    {hhmm(m.hora_entrada)} · {hhmm(m.hora_almoco_inicio) || "—"} ·{" "}
                    {hhmm(m.hora_almoco_fim) || "—"} · {hhmm(m.hora_saida)}{" "}
                    <span className="text-muted-foreground">
                      (previsto/dia{" "}
                      {formatDuration(
                        previstoTrabalhoMin({
                          horaEntrada: m.hora_entrada,
                          horaAlmocoInicio: m.hora_almoco_inicio,
                          horaAlmocoFim: m.hora_almoco_fim,
                          horaSaida: m.hora_saida,
                          dias: [
                            "dsr",
                            "trabalho",
                            "trabalho",
                            "trabalho",
                            "trabalho",
                            "trabalho",
                            "compensado",
                          ],
                        }),
                      )}
                      )
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {DIAS.map((d) => (
                      <Badge key={d.key} variant="outline" className="font-normal">
                        {d.label}:{" "}
                        {TIPO_OPCOES.find((t) => t.value === (m[d.key] as DiaTipo))?.label}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ---------------- VÍNCULOS ---------------- */}
        <TabsContent value="vinculos" className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Sem vínculo, o colaborador usa o modelo{" "}
            <strong>{modeloPadrao?.nome ?? "— (nenhum padrão definido)"}</strong>.
          </p>
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            perfis.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.nome ?? p.email ?? p.id}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.departamento ?? "—"}
                    </div>
                  </div>
                  <Select
                    value={vinculoDe.get(p.id) ?? "__default"}
                    onValueChange={(v) => vincular(p.id, v)}
                  >
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default">
                        Padrão do sistema{modeloPadrao ? ` (${modeloPadrao.nome})` : ""}
                      </SelectItem>
                      {modelos
                        .filter((m) => m.ativo)
                        .map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ---------------- FERIADOS ---------------- */}
        <TabsContent value="feriados" className="space-y-3">
          <Card>
            <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={feriadoData}
                  onChange={(e) => setFeriadoData(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Descrição</Label>
                <Input
                  value={feriadoDesc}
                  onChange={(e) => setFeriadoDesc(e.target.value)}
                  placeholder="Ex.: Corpus Christi"
                />
              </div>
              <Button onClick={addFeriado} disabled={salvando || !feriadoData}>
                <Plus className="mr-1.5 h-4 w-4" /> Adicionar
              </Button>
            </CardContent>
          </Card>

          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : feriados.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhum feriado cadastrado.
            </p>
          ) : (
            feriados.map((f) => (
              <Card key={f.id} className={f.ativo ? "" : "opacity-60"}>
                <CardContent className="flex items-center gap-3 p-3 text-sm">
                  <CalendarDays className="h-4 w-4 shrink-0 text-info" />
                  <span className="font-mono">{formatDate(f.data)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {f.descricao || "—"}
                  </span>
                  <Switch
                    checked={f.ativo}
                    onCheckedChange={() => toggleFeriado(f)}
                    title="Ativo"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => excluirFeriado(f)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog criar/editar modelo */}
      <Dialog open={!!modeloDialog} onOpenChange={(o) => !o && setModeloDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{modeloDialog?.id ? "Editar modelo" : "Novo modelo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex.: Padrão (44h)"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["hora_entrada", "Entrada"],
                  ["hora_almoco_inicio", "Início almoço"],
                  ["hora_almoco_fim", "Fim almoço"],
                  ["hora_saida", "Saída"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input
                    type="time"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Tolerância (min)</Label>
              <Input
                type="number"
                min={0}
                value={form.tolerancia_min}
                onChange={(e) => setForm((f) => ({ ...f, tolerancia_min: Number(e.target.value) }))}
                className="w-full sm:w-44"
              />
              <p className="text-xs text-muted-foreground">
                Saldo do dia dentro de ±tolerância não vira pendente nem hora extra. Acima, conta
                integralmente.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de cada dia da semana</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DIAS.map((d) => (
                  <div key={d.key} className="space-y-1">
                    <span className="text-xs text-muted-foreground">{d.label}</span>
                    <Select
                      value={form.dias[d.key]}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, dias: { ...f.dias, [d.key]: v as DiaTipo } }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPO_OPCOES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.padrao_sistema}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, padrao_sistema: v }))}
                />
                Padrão do sistema
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v }))}
                />
                Ativo
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModeloDialog(null)}>
              Cancelar
            </Button>
            <Button disabled={salvando || !form.nome.trim()} onClick={salvarModelo}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
