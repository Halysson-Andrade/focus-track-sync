// Insights operacionais por REGRAS (determinísticos) — camada "IA leve".
// Interpreta os dados já capturados e produz frases curtas para o gestor.
// (Evolução futura: trocar/complementar por um LLM.)

import type { NavRow, UserSnapshot } from "@/lib/operacional-snapshot";
import { formatDuration } from "@/lib/format";
import { isMeeting } from "./office-config";

export type InsightTone = "info" | "success" | "warning" | "danger";

export interface Insight {
  id: string;
  tone: InsightTone;
  emoji: string;
  text: string;
}

const FOCUS_MIN = 120; // 2h consecutivas no mesmo status ATIVO
const LUNCH_LIMIT_MIN = 60;
const PAUSE_LIMIT_MIN = 20;
const SWITCH_WINDOW_MS = 30 * 60 * 1000; // 30 min
const SWITCH_THRESHOLD = 8;

function firstName(nome: string): string {
  return nome.split(" ")[0];
}

/** Conta apps/sites distintos que o usuário tocou nos últimos 30 min. */
function recentSwitches(
  userId: string,
  navExt: NavRow[],
  navDesk: NavRow[],
  nowTs: number,
): number {
  const since = nowTs - SWITCH_WINDOW_MS;
  const labels = new Set<string>();
  for (const n of navExt) {
    if (n.usuario_id !== userId) continue;
    if (new Date(n.inicio).getTime() < since) continue;
    if (n.domain) labels.add("d:" + n.domain);
  }
  for (const n of navDesk) {
    if (n.usuario_id !== userId) continue;
    if (new Date(n.inicio).getTime() < since) continue;
    const k = n.app_label || n.process_name;
    if (k) labels.add("a:" + k);
  }
  return labels.size;
}

export function generateInsights(
  snapshots: UserSnapshot[],
  navExt: NavRow[],
  navDesk: NavRow[],
  nowTs: number,
): Insight[] {
  const out: Insight[] = [];

  // Média de produtividade da equipe (apenas quem tem tempo online).
  const withTime = snapshots.filter((s) => s.totalOnline > 0);
  const avgProd =
    withTime.length > 0
      ? withTime.reduce((a, s) => a + (s.totals.ATIVO / s.totalOnline) * 100, 0) / withTime.length
      : 0;

  for (const s of snapshots) {
    if (!s.isOnline) continue;
    const sinceMin = s.currentSince ? (nowTs - new Date(s.currentSince).getTime()) / 60000 : 0;
    const name = firstName(s.profile.nome);

    // Foco prolongado
    if (s.currentStatus === "ATIVO" && sinceMin >= FOCUS_MIN) {
      const what = isMeeting(s)
        ? "em reunião"
        : s.lastDesktopApp
          ? `em ${s.lastDesktopApp.label}`
          : s.lastUrl
            ? `em ${s.lastUrl.domain || s.lastUrl.title}`
            : "trabalhando";
      out.push({
        id: `focus-${s.profile.id}`,
        tone: "info",
        emoji: "🎯",
        text: `${name} está há ${formatDuration(sinceMin)} ${what}.`,
      });
    }

    // Almoço acima do limite
    if (s.currentStatus === "ALMOCO" && sinceMin >= LUNCH_LIMIT_MIN) {
      out.push({
        id: `lunch-${s.profile.id}`,
        tone: "warning",
        emoji: "🍽️",
        text: `${name} está em almoço há ${formatDuration(sinceMin)} (acima de 1h).`,
      });
    }

    // Pausa longa
    if (s.currentStatus === "PAUSA" && sinceMin >= PAUSE_LIMIT_MIN) {
      out.push({
        id: `pause-${s.profile.id}`,
        tone: "warning",
        emoji: "⏸️",
        text: `${name} está em pausa há ${formatDuration(sinceMin)}.`,
      });
    }

    // Troca excessiva de contexto
    const switches = recentSwitches(s.profile.id, navExt, navDesk, nowTs);
    if (switches >= SWITCH_THRESHOLD) {
      out.push({
        id: `switch-${s.profile.id}`,
        tone: "info",
        emoji: "🔀",
        text: `${name} alternou entre ${switches} aplicações nos últimos 30 min.`,
      });
    }

    // Acima da média
    const prod = (s.totals.ATIVO / Math.max(1, s.totalOnline)) * 100;
    if (avgProd > 0 && prod >= avgProd + 15 && s.totals.ATIVO >= 30) {
      out.push({
        id: `top-${s.profile.id}`,
        tone: "success",
        emoji: "🚀",
        text: `${name} está ${Math.round(prod - avgProd)}% acima da média da equipe.`,
      });
    }
  }

  // Gargalo: inativos simultâneos
  const inativos = snapshots.filter((s) => s.isOnline && s.currentStatus === "INATIVO");
  if (inativos.length >= 2) {
    out.push({
      id: "bottleneck-idle",
      tone: "danger",
      emoji: "⚠️",
      text: `Possível gargalo: ${inativos.length} pessoas inativas agora.`,
    });
  }

  // Reunião acontecendo
  const emReuniao = snapshots.filter((s) => s.isOnline && isMeeting(s));
  if (emReuniao.length >= 2) {
    out.push({
      id: "meeting-now",
      tone: "info",
      emoji: "📊",
      text: `Reunião em andamento com ${emReuniao.length} participantes.`,
    });
  }

  return out;
}
