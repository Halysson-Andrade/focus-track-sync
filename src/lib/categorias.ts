// Classificação de uso (domínio/processo → categoria) — ÚNICA fonte de verdade
// do match. Consumida tanto pelo dashboard (card "Tempo por categoria") quanto
// pela Central de Categorização, para que "pendente" lá == "Não categorizado" cá.

export type CategoriaRow = {
  tipo: string;
  identificador: string;
  categoria: string;
  produtiva: boolean;
};

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
