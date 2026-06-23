import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  buildCategoriaIndex,
  agruparPorGrupo,
  CATEGORIA_GRUPOS,
  CATEGORIAS_CATALOGO,
  type CategoriaRow,
} from "@/lib/categorias";
import { isChromeProcess } from "@/lib/activity-config";
import { formatSeconds, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Globe,
  Monitor,
  Search,
  Pencil,
  Trash2,
  Tags,
  Tag,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/categorias")({
  head: () => ({ meta: [{ title: "Categorias" }] }),
  component: CategoriasPage,
});

type PaletaGrupo = { grupo: string; itens: { categoria: string; produtiva: boolean }[] };

// Paleta de chips agrupados por tema: 1 clique preenche categoria + produtiva.
function CategoriaPalette({
  grupos,
  onPick,
  align = "end",
}: {
  grupos: PaletaGrupo[];
  onPick: (categoria: string, produtiva: boolean) => void;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          title="Escolher categoria do catálogo"
        >
          <Tag className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="max-h-80 w-72 space-y-3 overflow-y-auto">
        {grupos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma categoria no catálogo.</p>
        ) : (
          grupos.map((g) => (
            <div key={g.grupo} className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">{g.grupo}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.itens.map((c) => (
                  <button
                    key={c.categoria}
                    type="button"
                    onClick={() => {
                      onPick(c.categoria, c.produtiva);
                      setOpen(false);
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                      c.produtiva
                        ? "border-success/40 text-success"
                        : "border-muted-foreground/30 text-muted-foreground",
                    )}
                  >
                    {c.categoria}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

type ItemTipo = "dominio" | "processo";

type UsoItem = {
  tipo: ItemTipo;
  identificador: string;
  label: string | null;
  segundos: number;
  ocorrencias: number;
  ultima_vez: string | null;
};

type RegraRow = CategoriaRow & { id: string; ativo: boolean; created_at?: string };

type CatalogoRow = {
  id: string;
  nome: string;
  grupo: string;
  produtiva: boolean;
  ativo: boolean;
};

const itemKey = (i: { tipo: string; identificador: string }) => `${i.tipo}:${i.identificador}`;

const JANELAS = [
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "0", label: "Tudo" },
];

function CategoriasPage() {
  const { isSuperadmin, loading: authLoading } = useAuth();
  const router = useRouter();

  const [dias, setDias] = useState("30");
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<UsoItem[]>([]);
  const [regras, setRegras] = useState<RegraRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Rascunho da categorização inline por linha pendente.
  const [drafts, setDrafts] = useState<Record<string, { categoria: string; produtiva: boolean }>>(
    {},
  );
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [loteCategoria, setLoteCategoria] = useState("");
  const [loteProdutiva, setLoteProdutiva] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState<RegraRow | null>(null);
  const [editForm, setEditForm] = useState({ categoria: "", produtiva: true });

  // Catálogo de categorias (definições gerenciáveis).
  const [catalogo, setCatalogo] = useState<CatalogoRow[]>([]);
  const [catDialog, setCatDialog] = useState<{ id: string | null } | null>(null);
  const [catForm, setCatForm] = useState({ nome: "", grupo: "", produtiva: true });

  // Guarda de acesso: somente superadmin.
  useEffect(() => {
    if (!authLoading && !isSuperadmin) router.navigate({ to: "/" });
  }, [authLoading, isSuperadmin, router]);

  const loadRegras = useCallback(async () => {
    const { data } = await supabase
      .from("categoria_atividade")
      .select("id, tipo, identificador, categoria, produtiva, ativo, created_at")
      .order("categoria");
    setRegras((data ?? []) as RegraRow[]);
  }, []);

  const loadCatalogo = useCallback(async () => {
    const { data, error } = await supabase
      .from("categoria_catalogo")
      .select("id, nome, grupo, produtiva, ativo")
      .order("nome");
    // Pré-migration (tabela inexistente): segue só com o catálogo constante.
    if (error) {
      setCatalogo([]);
      return;
    }
    setCatalogo((data ?? []) as CatalogoRow[]);
  }, []);

  const loadItens = useCallback(async () => {
    const { data, error } = await supabase.rpc("itens_categorizacao", { p_dias: Number(dias) });
    if (error) {
      toast.error("Falha ao carregar uso", { description: error.message });
      setItens([]);
      return;
    }
    const payload = (data ?? {}) as {
      dominios?: Omit<UsoItem, "tipo" | "label">[] & { label?: never }[];
      processos?: (Omit<UsoItem, "tipo"> & { label: string | null })[];
    };
    const dominios: UsoItem[] = (
      (payload.dominios ?? []) as Array<{
        identificador: string;
        segundos: number;
        ocorrencias: number;
        ultima_vez: string | null;
      }>
    ).map((d) => ({
      tipo: "dominio",
      identificador: d.identificador,
      label: null,
      segundos: Number(d.segundos) || 0,
      ocorrencias: Number(d.ocorrencias) || 0,
      ultima_vez: d.ultima_vez,
    }));
    const processos: UsoItem[] = (
      (payload.processos ?? []) as Array<{
        identificador: string;
        label: string | null;
        segundos: number;
        ocorrencias: number;
        ultima_vez: string | null;
      }>
    )
      // Processos do Chrome são contabilizados pela extensão (navegação) — evita duplicar.
      .filter((p) => !isChromeProcess(p.identificador) && !isChromeProcess(p.label || ""))
      .map((p) => ({
        tipo: "processo",
        identificador: p.identificador,
        label: p.label,
        segundos: Number(p.segundos) || 0,
        ocorrencias: Number(p.ocorrencias) || 0,
        ultima_vez: p.ultima_vez,
      }));
    setItens([...dominios, ...processos]);
  }, [dias]);

  useEffect(() => {
    if (!isSuperadmin) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([loadItens(), loadRegras(), loadCatalogo()]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isSuperadmin, loadItens, loadRegras, loadCatalogo]);

  // Índice apenas com regras ATIVAS — paridade exata com o dashboard (que só
  // carrega ativo=true). Assim "pendente" aqui == "Não categorizado" lá.
  const index = useMemo(() => buildCategoriaIndex(regras.filter((r) => r.ativo)), [regras]);

  // Itens sem regra ativa correspondente, ordenados por tempo (maior impacto).
  const pendentes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens
      .filter((it) => {
        const hit =
          it.tipo === "dominio"
            ? index.matchDomain(it.identificador)
            : index.matchProcess(it.identificador, it.label);
        return !hit;
      })
      .filter(
        (it) => !q || it.identificador.includes(q) || (it.label || "").toLowerCase().includes(q),
      )
      .sort((a, b) => b.segundos - a.segundos);
  }, [itens, index, busca]);

  // Tempo resolvido por categoria (mesma lógica do dashboard) — alimenta o
  // cabeçalho de cada grupo na aba "Categorizados".
  const tempoPorCategoria = useMemo(() => {
    const m = new Map<string, number>();
    const add = (cat: string, seg: number) => m.set(cat, (m.get(cat) || 0) + seg);
    itens.forEach((it) => {
      const hit =
        it.tipo === "dominio"
          ? index.matchDomain(it.identificador)
          : index.matchProcess(it.identificador, it.label);
      if (hit) add(hit.categoria, it.segundos);
    });
    return m;
  }, [itens, index]);

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const m = new Map<string, RegraRow[]>();
    regras
      .filter(
        (r) =>
          !q || r.identificador.toLowerCase().includes(q) || r.categoria.toLowerCase().includes(q),
      )
      .forEach((r) => {
        const arr = m.get(r.categoria) ?? [];
        arr.push(r);
        m.set(r.categoria, arr);
      });
    return Array.from(m.entries())
      .map(([categoria, rs]) => ({
        categoria,
        regras: rs.sort((a, b) => a.identificador.localeCompare(b.identificador)),
        segundos: tempoPorCategoria.get(categoria) || 0,
        produtiva: rs.some((r) => r.produtiva),
      }))
      .sort((a, b) => b.segundos - a.segundos || a.categoria.localeCompare(b.categoria));
  }, [regras, tempoPorCategoria, busca]);

  // Catálogo efetivo: o do banco (se houver) ou o constante (fallback pré-migration),
  // normalizado para { categoria, produtiva, grupo }.
  const catalogoEfetivo = useMemo(
    () =>
      catalogo.length > 0
        ? catalogo
            .filter((c) => c.ativo)
            .map((c) => ({ categoria: c.nome, produtiva: c.produtiva, grupo: c.grupo }))
        : CATEGORIAS_CATALOGO.map((c) => ({
            categoria: c.categoria,
            produtiva: c.produtiva,
            grupo: c.grupo,
          })),
    [catalogo],
  );

  // Paleta de chips agrupada por tema (alimenta a CategoriaPalette).
  const paletaGrupos = useMemo(() => agruparPorGrupo(catalogoEfetivo), [catalogoEfetivo]);

  // Grupos sugeridos no formulário de "nova categoria".
  const gruposSugeridos = useMemo(
    () => Array.from(new Set([...CATEGORIA_GRUPOS, ...catalogo.map((c) => c.grupo)])),
    [catalogo],
  );

  // Sugestões do datalist: catálogo + categorias já cadastradas (dedup).
  const categoriasExistentes = useMemo(
    () =>
      Array.from(
        new Set([...catalogoEfetivo.map((c) => c.categoria), ...regras.map((r) => r.categoria)]),
      ).sort(),
    [catalogoEfetivo, regras],
  );

  const setDraft = (key: string, patch: Partial<{ categoria: string; produtiva: boolean }>) =>
    setDrafts((d) => {
      const cur = d[key] ?? { categoria: "", produtiva: true };
      return { ...d, [key]: { ...cur, ...patch } };
    });

  const inserirRegras = async (
    novos: { tipo: ItemTipo; identificador: string; categoria: string; produtiva: boolean }[],
  ) => {
    const limpos = novos
      .map((n) => ({ ...n, categoria: n.categoria.trim() }))
      .filter((n) => n.categoria.length > 0);
    if (limpos.length === 0) {
      toast.error("Informe a categoria.");
      return false;
    }
    setSalvando(true);
    const { error } = await supabase.from("categoria_atividade").insert(
      limpos.map((n) => ({
        tipo: n.tipo,
        identificador: n.identificador,
        categoria: n.categoria,
        produtiva: n.produtiva,
        ativo: true,
      })),
    );
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar", { description: error.message });
      return false;
    }
    await loadRegras();
    return true;
  };

  const salvarUm = async (item: UsoItem) => {
    const key = itemKey(item);
    const draft = drafts[key] ?? { categoria: "", produtiva: true };
    const ok = await inserirRegras([
      {
        tipo: item.tipo,
        identificador: item.identificador,
        categoria: draft.categoria,
        produtiva: draft.produtiva,
      },
    ]);
    if (ok) {
      toast.success(`"${item.identificador}" categorizado.`);
      setDrafts((d) => {
        const { [key]: _omit, ...rest } = d;
        return rest;
      });
      setSelecionados((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  const salvarLote = async () => {
    const alvo = pendentes.filter((p) => selecionados.has(itemKey(p)));
    if (alvo.length === 0) return;
    const ok = await inserirRegras(
      alvo.map((it) => ({
        tipo: it.tipo,
        identificador: it.identificador,
        categoria: loteCategoria,
        produtiva: loteProdutiva,
      })),
    );
    if (ok) {
      toast.success(`${alvo.length} item(ns) categorizados em "${loteCategoria.trim()}".`);
      setSelecionados(new Set());
      setLoteCategoria("");
    }
  };

  const toggleAtivo = async (r: RegraRow) => {
    const { error } = await supabase
      .from("categoria_atividade")
      .update({ ativo: !r.ativo })
      .eq("id", r.id);
    if (error) return toast.error("Falha ao atualizar", { description: error.message });
    await loadRegras();
  };

  const salvarEdicao = async () => {
    if (!editando) return;
    const categoria = editForm.categoria.trim();
    if (!categoria) return toast.error("Informe a categoria.");
    const { error } = await supabase
      .from("categoria_atividade")
      .update({ categoria, produtiva: editForm.produtiva })
      .eq("id", editando.id);
    if (error) return toast.error("Falha ao salvar", { description: error.message });
    setEditando(null);
    await loadRegras();
    toast.success("Regra atualizada.");
  };

  const excluir = async (r: RegraRow) => {
    if (!confirm(`Excluir a regra de "${r.identificador}"?`)) return;
    const { error } = await supabase.from("categoria_atividade").delete().eq("id", r.id);
    if (error) return toast.error("Falha ao excluir", { description: error.message });
    await loadRegras();
    toast.success("Regra excluída.");
  };

  const toggleSel = (key: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // ---- Catálogo de categorias (definições) ----
  const abrirNovaCategoria = () => {
    setCatForm({ nome: "", grupo: "", produtiva: true });
    setCatDialog({ id: null });
  };
  const abrirEditarCategoria = (c: CatalogoRow) => {
    setCatForm({ nome: c.nome, grupo: c.grupo, produtiva: c.produtiva });
    setCatDialog({ id: c.id });
  };

  const salvarCategoria = async () => {
    const nome = catForm.nome.trim();
    if (!nome) return toast.error("Informe o nome da categoria.");
    const grupo = catForm.grupo.trim() || "Outras";
    setSalvando(true);
    const { error } = catDialog?.id
      ? await supabase
          .from("categoria_catalogo")
          .update({ nome, grupo, produtiva: catForm.produtiva })
          .eq("id", catDialog.id)
      : await supabase
          .from("categoria_catalogo")
          .insert({ nome, grupo, produtiva: catForm.produtiva });
    setSalvando(false);
    if (error) {
      const dup = error.code === "23505";
      return toast.error(dup ? "Já existe uma categoria com esse nome." : "Falha ao salvar", {
        description: dup ? undefined : error.message,
      });
    }
    setCatDialog(null);
    await loadCatalogo();
    toast.success(catDialog?.id ? "Categoria atualizada." : "Categoria criada.");
  };

  const toggleAtivoCategoria = async (c: CatalogoRow) => {
    const { error } = await supabase
      .from("categoria_catalogo")
      .update({ ativo: !c.ativo })
      .eq("id", c.id);
    if (error) return toast.error("Falha ao atualizar", { description: error.message });
    await loadCatalogo();
  };

  const excluirCategoria = async (c: CatalogoRow) => {
    if (!confirm(`Excluir a categoria "${c.nome}" do catálogo?`)) return;
    const { error } = await supabase.from("categoria_catalogo").delete().eq("id", c.id);
    if (error) return toast.error("Falha ao excluir", { description: error.message });
    await loadCatalogo();
    toast.success("Categoria excluída.");
  };

  // Catálogo agrupado por tema p/ a aba de gestão (inclui inativas).
  const catalogoGrupos = useMemo(
    () => agruparPorGrupo([...catalogo].sort((a, b) => a.nome.localeCompare(b.nome))),
    [catalogo],
  );

  if (authLoading || !isSuperadmin) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Tags className="h-5 w-5" /> Categorias
        </h1>
        <p className="text-sm text-muted-foreground">
          Classifique apps e sites para refletir no card <strong>Tempo por categoria</strong> do
          dashboard.
        </p>
      </div>

      {/* Controles sticky: janela + busca */}
      <div className="sticky top-16 z-10 -mx-1 flex flex-col gap-2 rounded-lg bg-background/85 px-1 py-2 backdrop-blur sm:flex-row sm:items-center">
        <Select value={dias} onValueChange={setDias}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JANELAS.map((j) => (
              <SelectItem key={j.value} value={j.value}>
                {j.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar app, site ou categoria…"
            className="pl-8"
          />
        </div>
      </div>

      {/* Datalist global de categorias já usadas. */}
      <datalist id="categorias-existentes">
        {categoriasExistentes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <Tabs defaultValue="pendentes">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="pendentes" className="flex-1 sm:flex-none">
            Pendentes ({pendentes.length})
          </TabsTrigger>
          <TabsTrigger value="categorizados" className="flex-1 sm:flex-none">
            Categorizados ({regras.length})
          </TabsTrigger>
          <TabsTrigger value="catalogo" className="flex-1 sm:flex-none">
            Catálogo ({catalogo.length || catalogoEfetivo.length})
          </TabsTrigger>
        </TabsList>

        {/* ---------------- PENDENTES ---------------- */}
        <TabsContent value="pendentes" className="space-y-2">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : pendentes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm">Tudo categorizado 🎉</p>
            </div>
          ) : (
            pendentes.map((it) => {
              const key = itemKey(it);
              const draft = drafts[key] ?? { categoria: "", produtiva: true };
              return (
                <Card key={key}>
                  <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                    <Checkbox
                      checked={selecionados.has(key)}
                      onCheckedChange={() => toggleSel(key)}
                      className="hidden sm:grid"
                      aria-label="Selecionar"
                    />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {it.tipo === "dominio" ? (
                        <Globe className="h-4 w-4 shrink-0 text-info" />
                      ) : (
                        <Monitor className="h-4 w-4 shrink-0 text-primary" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {it.label && it.label !== it.identificador ? it.label : it.identificador}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {it.label && it.label !== it.identificador
                            ? `${it.identificador} · `
                            : ""}
                          {formatSeconds(it.segundos)} · {it.ocorrencias}x ·{" "}
                          {formatDate(it.ultima_vez)}
                        </div>
                      </div>
                      {it.tipo === "dominio" && (
                        <a
                          href={`https://${it.identificador}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Abrir ${it.identificador}`}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-2">
                        <CategoriaPalette
                          grupos={paletaGrupos}
                          onPick={(categoria, produtiva) => setDraft(key, { categoria, produtiva })}
                        />
                        <Input
                          list="categorias-existentes"
                          value={draft.categoria}
                          onChange={(e) => setDraft(key, { categoria: e.target.value })}
                          placeholder="Categoria…"
                          className="h-9 flex-1 sm:w-44"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={draft.produtiva}
                          onCheckedChange={(v) => setDraft(key, { produtiva: v })}
                        />
                        <span
                          className={draft.produtiva ? "text-success" : "text-muted-foreground"}
                        >
                          {draft.produtiva ? "Produtiva" : "Improdutiva"}
                        </span>
                      </label>
                      <Button
                        size="sm"
                        disabled={salvando || !draft.categoria.trim()}
                        onClick={() => salvarUm(it)}
                      >
                        Salvar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ---------------- CATEGORIZADOS ---------------- */}
        <TabsContent value="categorizados" className="space-y-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : grupos.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma regra cadastrada ainda.
            </p>
          ) : (
            grupos.map((g) => (
              <Card key={g.categoria}>
                <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 py-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {g.categoria}
                    <Badge variant={g.produtiva ? "default" : "secondary"}>
                      {g.produtiva ? "Produtiva" : "Improdutiva"}
                    </Badge>
                  </CardTitle>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {formatSeconds(g.segundos)} · {g.regras.length}{" "}
                    regra(s)
                  </span>
                </CardHeader>
                <CardContent className="space-y-1 py-0 pb-3">
                  {g.regras.map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                        r.ativo ? "" : "opacity-50"
                      }`}
                    >
                      {r.tipo === "dominio" ? (
                        <Globe className="h-4 w-4 shrink-0 text-info" />
                      ) : (
                        <Monitor className="h-4 w-4 shrink-0 text-primary" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{r.identificador}</span>
                      {r.tipo === "dominio" && (
                        <a
                          href={`https://${r.identificador}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Abrir ${r.identificador}`}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <Badge variant="outline" className="hidden sm:inline-flex">
                        {r.tipo}
                      </Badge>
                      <label
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                        title="Ativa"
                      >
                        <Switch checked={r.ativo} onCheckedChange={() => toggleAtivo(r)} />
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditando(r);
                          setEditForm({ categoria: r.categoria, produtiva: r.produtiva });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => excluir(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ---------------- CATÁLOGO (gerenciar categorias) ---------------- */}
        <TabsContent value="catalogo" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Crie e organize as categorias usadas na classificação.
            </p>
            <Button size="sm" onClick={abrirNovaCategoria}>
              <Plus className="mr-1.5 h-4 w-4" /> Nova categoria
            </Button>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : catalogo.length === 0 ? (
            <div className="space-y-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <p>
                O catálogo ainda não foi inicializado no banco. Exibindo as categorias padrão; crie
                uma para começar a persistir.
              </p>
            </div>
          ) : (
            catalogoGrupos.map((g) => (
              <Card key={g.grupo}>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">{g.grupo}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 py-0 pb-3">
                  {g.itens.map((c) => (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                        c.ativo ? "" : "opacity-50"
                      }`}
                    >
                      <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                      <Badge variant={c.produtiva ? "default" : "secondary"}>
                        {c.produtiva ? "Produtiva" : "Improdutiva"}
                      </Badge>
                      <Switch
                        checked={c.ativo}
                        onCheckedChange={() => toggleAtivoCategoria(c)}
                        title="Ativa"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => abrirEditarCategoria(c)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => excluirCategoria(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Barra de ação em lote (flutuante) */}
      {selecionados.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-lg sm:flex-row sm:items-center">
          <span className="text-sm font-medium">{selecionados.size} selecionado(s)</span>
          <div className="flex flex-1 items-center gap-2">
            <CategoriaPalette
              grupos={paletaGrupos}
              align="start"
              onPick={(categoria, produtiva) => {
                setLoteCategoria(categoria);
                setLoteProdutiva(produtiva);
              }}
            />
            <Input
              list="categorias-existentes"
              value={loteCategoria}
              onChange={(e) => setLoteCategoria(e.target.value)}
              placeholder="Categoria para todos…"
              className="h-9 flex-1 sm:w-48"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={loteProdutiva} onCheckedChange={setLoteProdutiva} />
            <span className={loteProdutiva ? "text-success" : "text-muted-foreground"}>
              {loteProdutiva ? "Produtiva" : "Improdutiva"}
            </span>
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={salvando || !loteCategoria.trim()} onClick={salvarLote}>
              Categorizar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())}>
              Limpar
            </Button>
          </div>
        </div>
      )}

      {/* Dialog de edição */}
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar regra</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {editando.tipo === "dominio" ? "Site" : "App"}:{" "}
                <strong>{editando.identificador}</strong>
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <div className="flex items-center gap-2">
                  <CategoriaPalette
                    grupos={paletaGrupos}
                    onPick={(categoria, produtiva) => setEditForm({ categoria, produtiva })}
                  />
                  <Input
                    list="categorias-existentes"
                    value={editForm.categoria}
                    onChange={(e) => setEditForm((f) => ({ ...f, categoria: e.target.value }))}
                    className="flex-1"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={editForm.produtiva}
                  onCheckedChange={(v) => setEditForm((f) => ({ ...f, produtiva: v }))}
                />
                {editForm.produtiva ? "Produtiva" : "Improdutiva"}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicao}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Datalist de grupos (temas) sugeridos */}
      <datalist id="grupos-existentes">
        {gruposSugeridos.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      {/* Dialog criar/editar categoria do catálogo */}
      <Dialog open={!!catDialog} onOpenChange={(o) => !o && setCatDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{catDialog?.id ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={catForm.nome}
                onChange={(e) => setCatForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex.: Suporte ao cliente"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Grupo (tema)</Label>
              <Input
                list="grupos-existentes"
                value={catForm.grupo}
                onChange={(e) => setCatForm((f) => ({ ...f, grupo: e.target.value }))}
                placeholder="Ex.: Sistemas & Trabalho"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={catForm.produtiva}
                onCheckedChange={(v) => setCatForm((f) => ({ ...f, produtiva: v }))}
              />
              {catForm.produtiva ? "Produtiva" : "Improdutiva"}
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCatDialog(null)}>
              Cancelar
            </Button>
            <Button disabled={salvando || !catForm.nome.trim()} onClick={salvarCategoria}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
