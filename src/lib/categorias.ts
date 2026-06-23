// Classificação de uso (domínio/processo → categoria) — ÚNICA fonte de verdade
// do match. Consumida tanto pelo dashboard (card "Tempo por categoria") quanto
// pela Central de Categorização, para que "pendente" lá == "Não categorizado" cá.

export type CategoriaRow = {
  tipo: string;
  identificador: string;
  categoria: string;
  produtiva: boolean;
};

// Catálogo de categorias sugeridas, agrupadas por tema, com a classificação
// produtiva padrão. Alimenta a paleta de chips da Central de Categorização
// (1 clique preenche categoria + produtiva) e o datalist de sugestões. NÃO é
// uma tabela: categorias continuam sendo texto livre em categoria_atividade —
// este catálogo só acelera/uniformiza o cadastro.
export type CategoriaCatalogo = { categoria: string; produtiva: boolean; grupo: string };

export const CATEGORIA_GRUPOS = [
  "Sistemas & Trabalho",
  "Comunicação",
  "Informação & Lazer",
] as const;

export const CATEGORIAS_CATALOGO: CategoriaCatalogo[] = [
  // Sistemas & Trabalho (produtivas)
  { categoria: "Sistema interno", produtiva: true, grupo: "Sistemas & Trabalho" },
  { categoria: "Ferramenta de trabalho", produtiva: true, grupo: "Sistemas & Trabalho" },
  { categoria: "Uso de IA", produtiva: true, grupo: "Sistemas & Trabalho" },
  { categoria: "Desenvolvimento", produtiva: true, grupo: "Sistemas & Trabalho" },
  { categoria: "Documentação", produtiva: true, grupo: "Sistemas & Trabalho" },
  // Comunicação (produtivas)
  { categoria: "Telefone", produtiva: true, grupo: "Comunicação" },
  { categoria: "Comunicação", produtiva: true, grupo: "Comunicação" },
  { categoria: "Reunião", produtiva: true, grupo: "Comunicação" },
  // Informação & Lazer (improdutivas)
  { categoria: "Notícias", produtiva: false, grupo: "Informação & Lazer" },
  { categoria: "Mídia Social", produtiva: false, grupo: "Informação & Lazer" },
  { categoria: "Distração", produtiva: false, grupo: "Informação & Lazer" },
];

/** Catálogo agrupado por tema, na ordem de CATEGORIA_GRUPOS. */
export function catalogoPorGrupo(): { grupo: string; itens: CategoriaCatalogo[] }[] {
  return CATEGORIA_GRUPOS.map((grupo) => ({
    grupo,
    itens: CATEGORIAS_CATALOGO.filter((c) => c.grupo === grupo),
  }));
}

/**
 * Agrupa itens por `grupo`, com os temas conhecidos (CATEGORIA_GRUPOS) primeiro,
 * na sua ordem, e os demais grupos em ordem alfabética ao final. Grupos vazios
 * são omitidos.
 */
export function agruparPorGrupo<T extends { grupo: string }>(
  itens: T[],
): { grupo: string; itens: T[] }[] {
  const ordem = CATEGORIA_GRUPOS as readonly string[];
  const grupos = Array.from(new Set(itens.map((i) => i.grupo)));
  grupos.sort((a, b) => {
    const ia = ordem.indexOf(a);
    const ib = ordem.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return grupos.map((grupo) => ({ grupo, itens: itens.filter((i) => i.grupo === grupo) }));
}

/** Produtiva sugerida para uma categoria do catálogo (default true se desconhecida). */
export function produtivaSugerida(categoria: string): boolean {
  const hit = CATEGORIAS_CATALOGO.find(
    (c) => c.categoria.toLowerCase() === categoria.trim().toLowerCase(),
  );
  return hit ? hit.produtiva : true;
}

export type CategoriaMatch = { categoria: string; produtiva: boolean };

/**
 * Indexa as regras de `categoria_atividade` e devolve buscadores por domínio e
 * por processo. Domínio casa por sufixo (o próprio domínio ou um subdomínio:
 * "api.github.com" casa com "github.com"). Processo casa por `process_name` ou,
 * em fallback, pelo `app_label`. Tudo case-insensitive.
 *
 * Passe SOMENTE regras ativas se quiser paridade exata com o dashboard, que só
 * carrega `ativo = true`.
 */
export function buildCategoriaIndex(categorias: CategoriaRow[]) {
  const domainCat = new Map<string, CategoriaMatch>();
  const procCat = new Map<string, CategoriaMatch>();
  categorias.forEach((c) => {
    const key = c.identificador.toLowerCase();
    const val: CategoriaMatch = { categoria: c.categoria, produtiva: c.produtiva };
    if (c.tipo === "dominio") domainCat.set(key, val);
    else if (c.tipo === "processo") procCat.set(key, val);
  });

  const matchDomain = (domain: string | null | undefined): CategoriaMatch | undefined => {
    const d = (domain || "").toLowerCase();
    if (!d) return undefined;
    if (domainCat.has(d)) return domainCat.get(d);
    for (const [id, val] of domainCat) if (d === id || d.endsWith("." + id)) return val;
    return undefined;
  };

  const matchProcess = (
    process_name: string | null | undefined,
    label?: string | null,
  ): CategoriaMatch | undefined =>
    procCat.get((process_name || "").toLowerCase()) ?? procCat.get((label || "").toLowerCase());

  return { matchDomain, matchProcess };
}
