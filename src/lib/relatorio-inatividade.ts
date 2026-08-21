// Derivação do Relatório de Inatividade a partir do payload cru da RPC
// `relatorio_inatividade` (registros ATIVO + eventos de ociosidade da equipe).
//
// O ócio por colaborador é calculado com `ocioReconciliadoSeg` — a MESMA fonte
// única usada no dashboard, escritório virtual e espelho de ponto — garantindo que
// o número do ranking bate com o "Ócio" que o usuário já vê nas outras telas.
// A fórmula de duração das janelas ATIVO espelha `ranking.tsx` (duracao_minutos
// quando fechada; senão, agora − início).

import { ocioDetalhado } from "./ocio";
import {
  intervalosAprovados,
  duracaoMin,
  type JustificativaOcioPayload,
} from "./justificativas-ocio";
import { DEPARTAMENTOS } from "@/components/office/office-config";

export type InatividadePayload = {
  profiles: { id: string; nome: string | null; departamento: string | null }[];
  registros: {
    usuario_id: string;
    inicio: string;
    fim: string | null;
    duracao_minutos: number | null;
  }[];
  eventos: { usuario_id: string; inicio: string; fim: string | null }[];
  justificativas: JustificativaOcioPayload[];
};

export type LinhaColaborador = {
  usuarioId: string;
  nome: string;
  departamento: string | null;
  setorLabel: string;
  ativoMin: number;
  /** Ócio que CONTA no ranking: já descontado o justificado e aprovado. */
  ocioMin: number;
  ocioBrutoMin: number;
  ocioJustificadoMin: number;
  /** Ócio como % do tempo ativo (comparável entre jornadas diferentes). */
  pctOcio: number;
};

export type LinhaSetor = {
  setorLabel: string;
  colaboradores: number;
  ativoMin: number;
  ocioMin: number;
  ocioBrutoMin: number;
  ocioJustificadoMin: number;
  pctOcio: number;
};

/** Linha da aba "Justificativas" (todos os status, do escopo/setor selecionado). */
export type LinhaJustificativa = {
  id: string;
  nome: string;
  setorLabel: string;
  dia: string;
  inicio: string;
  fim: string;
  duracaoMin: number;
  justificativa: string;
  status: JustificativaOcioPayload["status"];
  decididoPorNome: string | null;
  justificativaDecisao: string | null;
};

export type RelatorioInatividade = {
  colaboradores: LinhaColaborador[]; // ordenado por ócio (líquido) desc
  setores: LinhaSetor[]; // ordenado por ócio (líquido) desc
  justificativas: LinhaJustificativa[]; // ordenado por dia desc
  totalAtivoMin: number;
  totalOcioMin: number;
  totalOcioJustificadoMin: number;
  totalColaboradores: number;
};

const SEM_SETOR = "Sem setor";

/** Rótulo canônico do setor a partir do `departamento` (livre) — tolerante ao
 *  valor OU label salvo (case-insensitive), como `pertenceAoSetor` do espelho. */
export function setorLabel(dep: string | null | undefined): string {
  const d = (dep ?? "").trim().toLowerCase();
  if (!d) return SEM_SETOR;
  const found = DEPARTAMENTOS.find(
    (x) => x.value.toLowerCase() === d || x.label.toLowerCase() === d,
  );
  return found?.label ?? (dep?.trim() || SEM_SETOR);
}

/** Um colaborador pertence ao setor quando o `departamento` bate com o value OU o
 *  label canônico (mesma regra do espelho de ponto). */
export function pertenceAoSetor(
  dep: string | null | undefined,
  setor: { value: string; label: string },
): boolean {
  const d = (dep ?? "").trim().toLowerCase();
  if (!d) return false;
  return d === setor.value.toLowerCase() || d === setor.label.toLowerCase();
}

/**
 * Monta o relatório. `setor` = "all" ou o value canônico de DEPARTAMENTOS; quando
 * != "all", inclui apenas colaboradores daquele setor. `nowTs` fecha janelas
 * abertas (fim nulo) no instante atual.
 */
export function montarRelatorio(
  payload: InatividadePayload,
  setor: string,
  nowTs: number,
): RelatorioInatividade {
  const setorFiltro =
    setor && setor !== "all" ? (DEPARTAMENTOS.find((d) => d.value === setor) ?? null) : null;

  // Perfis dentro do escopo/setor selecionado.
  const perfis = payload.profiles.filter(
    (p) => !setorFiltro || pertenceAoSetor(p.departamento, setorFiltro),
  );
  const idsVisiveis = new Set(perfis.map((p) => p.id));

  // Janelas ATIVO e eventos de ócio agrupados por usuário (só dos visíveis).
  const ativosByUser = new Map<string, { inicio: string; fim: string | null }[]>();
  const ativoMinByUser = new Map<string, number>();
  for (const r of payload.registros) {
    if (!idsVisiveis.has(r.usuario_id)) continue;
    const dur =
      r.duracao_minutos ??
      (r.fim
        ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
        : (nowTs - new Date(r.inicio).getTime()) / 60000);
    ativoMinByUser.set(r.usuario_id, (ativoMinByUser.get(r.usuario_id) ?? 0) + Math.max(0, dur));
    const list = ativosByUser.get(r.usuario_id) ?? [];
    list.push({ inicio: r.inicio, fim: r.fim });
    ativosByUser.set(r.usuario_id, list);
  }

  const eventosByUser = new Map<string, { inicio: string; fim: string | null }[]>();
  for (const e of payload.eventos) {
    if (!idsVisiveis.has(e.usuario_id)) continue;
    const list = eventosByUser.get(e.usuario_id) ?? [];
    list.push({ inicio: e.inicio, fim: e.fim });
    eventosByUser.set(e.usuario_id, list);
  }

  // Justificativas do escopo visível (todos os status: as aprovadas descontam,
  // as demais só aparecem na aba de relatório).
  const justificativasVisiveis = (payload.justificativas ?? []).filter((j) =>
    idsVisiveis.has(j.usuario_id),
  );
  const justByUser = new Map<string, JustificativaOcioPayload[]>();
  for (const j of justificativasVisiveis) {
    const list = justByUser.get(j.usuario_id) ?? [];
    list.push(j);
    justByUser.set(j.usuario_id, list);
  }

  const colaboradores: LinhaColaborador[] = perfis
    .map((p) => {
      const ativoMin = ativoMinByUser.get(p.id) ?? 0;
      const ocio = ocioDetalhado(
        eventosByUser.get(p.id) ?? [],
        ativosByUser.get(p.id) ?? [],
        nowTs,
        intervalosAprovados(justByUser.get(p.id) ?? []),
      );
      const ocioMin = ocio.liquidoSeg / 60;
      return {
        usuarioId: p.id,
        nome: p.nome ?? "—",
        departamento: p.departamento,
        setorLabel: setorLabel(p.departamento),
        ativoMin,
        ocioMin,
        ocioBrutoMin: ocio.brutoSeg / 60,
        ocioJustificadoMin: ocio.justificadoSeg / 60,
        pctOcio: ativoMin > 0 ? (ocioMin / ativoMin) * 100 : 0,
      };
    })
    .sort((a, b) => b.ocioMin - a.ocioMin);

  // Agregação por setor.
  const setorMap = new Map<
    string,
    {
      colaboradores: number;
      ativoMin: number;
      ocioMin: number;
      ocioBrutoMin: number;
      ocioJustificadoMin: number;
    }
  >();
  for (const c of colaboradores) {
    const s = setorMap.get(c.setorLabel) ?? {
      colaboradores: 0,
      ativoMin: 0,
      ocioMin: 0,
      ocioBrutoMin: 0,
      ocioJustificadoMin: 0,
    };
    s.colaboradores += 1;
    s.ativoMin += c.ativoMin;
    s.ocioMin += c.ocioMin;
    s.ocioBrutoMin += c.ocioBrutoMin;
    s.ocioJustificadoMin += c.ocioJustificadoMin;
    setorMap.set(c.setorLabel, s);
  }
  const setores: LinhaSetor[] = Array.from(setorMap.entries())
    .map(([label, s]) => ({
      setorLabel: label,
      colaboradores: s.colaboradores,
      ativoMin: s.ativoMin,
      ocioMin: s.ocioMin,
      ocioBrutoMin: s.ocioBrutoMin,
      ocioJustificadoMin: s.ocioJustificadoMin,
      pctOcio: s.ativoMin > 0 ? (s.ocioMin / s.ativoMin) * 100 : 0,
    }))
    .sort((a, b) => b.ocioMin - a.ocioMin);

  // Aba de justificativas: mesma lista já recortada por escopo/setor.
  const nomePorId = new Map(perfis.map((p) => [p.id, p.nome ?? "—"]));
  const justificativas: LinhaJustificativa[] = justificativasVisiveis
    .map((j) => ({
      id: j.id,
      nome: nomePorId.get(j.usuario_id) ?? j.usuario_nome,
      setorLabel: setorLabel(j.departamento),
      dia: j.dia,
      inicio: j.inicio,
      fim: j.fim,
      duracaoMin: duracaoMin(j),
      justificativa: j.justificativa,
      status: j.status,
      decididoPorNome: j.decidido_por_nome,
      justificativaDecisao: j.justificativa_decisao,
    }))
    .sort((a, b) => (a.dia === b.dia ? a.nome.localeCompare(b.nome) : b.dia.localeCompare(a.dia)));

  const totalAtivoMin = colaboradores.reduce((acc, c) => acc + c.ativoMin, 0);
  const totalOcioMin = colaboradores.reduce((acc, c) => acc + c.ocioMin, 0);
  const totalOcioJustificadoMin = colaboradores.reduce((acc, c) => acc + c.ocioJustificadoMin, 0);

  return {
    colaboradores,
    setores,
    justificativas,
    totalAtivoMin,
    totalOcioMin,
    totalOcioJustificadoMin,
    totalColaboradores: colaboradores.length,
  };
}
