// Cálculo de snapshot operacional por colaborador, extraído de
// routes/_authenticated/operacional.tsx para ser reusado tanto pela visão de
// LISTA quanto pelo ESCRITÓRIO VIRTUAL (mapa). Função pura, sem efeitos.

import { isChromeProcess } from "./activity-config";

export type Profile = {
  id: string;
  nome: string;
  email: string;
  cargo?: string | null;
  departamento?: string | null;
};

export type Registro = {
  id: string;
  usuario_id: string;
  status: string;
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
};

export type NavRow = {
  usuario_id: string;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
  inativo_segundos: number;
  url?: string;
  title?: string;
  domain?: string;
  path?: string;
  process_name?: string;
  app_label?: string;
};

/** Heartbeat de presença do app desktop (cadência ~30s enquanto não-ocioso). */
export type Presenca = {
  usuario_id: string;
  /** Atividade REAL (input). Ancora a presença `isOnline`. */
  ultimo_ativo: string;
  /** "Cliente vivo" — pulsa mesmo ocioso (presenca_desktop/extensao.ultimo_visto).
   *  Ancora o selo de "monitoração ativa", NÃO o `isOnline`. */
  ultimo_visto?: string | null;
  /** Origem do heartbeat. `web`/`desktop` ancoram online; `ext` só monitoração. */
  fonte?: "desktop" | "web" | "ext";
};

export interface UserSnapshot {
  profile: Profile;
  /** Usuário com papel admin — alocado na sala de Liderança quando online. */
  isAdmin: boolean;
  isOnline: boolean;
  /** Extensão do navegador enviando dados recentemente (monitoração ativa). */
  extActive: boolean;
  /** App desktop enviando heartbeat/uso recentemente (monitoração ativa). */
  desktopActive: boolean;
  currentStatus: string;
  currentSince: string | null;
  totals: { ATIVO: number; PAUSA: number; ALMOCO: number; INATIVO: number };
  totalOnline: number;
  lastSeen: string | null;
  navSegSource: { app: number; ext: number; desktop: number };
  idleSeconds: number;
  /** `live` = segmento aberto e com heartbeat recente (em foco agora). */
  lastUrl: { url: string; title: string; domain: string; live: boolean } | null;
  lastAppPage: { path: string; title: string } | null;
  /** Último app desktop em foco (process_name/app_label), p/ detecção de reunião. */
  lastDesktopApp: { process: string; label: string; live: boolean } | null;
}

function durSec(n: NavRow, nowTs: number): number {
  const d =
    n.duracao_segundos ??
    (n.fim
      ? (new Date(n.fim).getTime() - new Date(n.inicio).getTime()) / 1000
      : (nowTs - new Date(n.inicio).getTime()) / 1000);
  return Math.max(0, d);
}

/**
 * Janela de "sinal vivo" para detecção de reunião: o segmento de app/URL precisa
 * estar ABERTO e com heartbeat (inicio + duracao_segundos) nos últimos minutos.
 * Mais curta que a janela de presença (15 min) para refletir o foco ATUAL —
 * evita prender o avatar na reunião por uma aba/app esquecido em segundo plano.
 */
const MEETING_RECENCY_MS = 5 * 60_000;

/**
 * Janelas de "monitoração ativa" por cliente (selos no avatar). Distintas da
 * presença online (15 min): aqui queremos saber se o CLIENTE está vivo AGORA.
 * Os clientes gravam um heartbeat dedicado de "app vivo" (~60s, mesmo ocioso):
 *   - desktop: `presenca_desktop.ultimo_visto`.
 *   - extensão: `presenca_extensao.ultimo_visto`.
 * Fallback (cliente antigo sem esse heartbeat): último beat de navegação.
 */
const DESKTOP_ACTIVE_MS = 2 * 60_000;
const EXT_ACTIVE_MS = 6 * 60_000;

/** Instante do último "beat" conhecido de uma fonte de navegação (aberto ou não). */
function lastBeatOf(rows: NavRow[]): number {
  let max = 0;
  for (const n of rows) {
    const beat = n.fim
      ? new Date(n.fim).getTime()
      : new Date(n.inicio).getTime() + (n.duracao_segundos ?? 0) * 1000;
    if (beat > max) max = beat;
  }
  return max;
}

/** `true` se o segmento está aberto e com atividade recente (em foco agora). */
function isLiveSegment(n: NavRow | undefined, nowTs: number): boolean {
  if (!n || n.fim) return false;
  const beat = new Date(n.inicio).getTime() + (n.duracao_segundos ?? 0) * 1000;
  return nowTs - beat < MEETING_RECENCY_MS;
}

function latestOpenOrRecent(rows: NavRow[]): NavRow | undefined {
  const open = rows
    .filter((n) => !n.fim)
    .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0];
  return (
    open ?? rows.sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0]
  );
}

export function buildSnapshots(
  profiles: Profile[],
  registros: Registro[],
  navApp: NavRow[],
  navExt: NavRow[],
  navDesk: NavRow[],
  nowTs: number,
  presenca: Presenca[] = [],
  adminIds: Set<string> = new Set(),
): UserSnapshot[] {
  // Mapas de heartbeat por usuário:
  //   - `presencaByUser`: ATIVIDADE real (ultimo_ativo) de desktop+web. Ancora o
  //     `isOnline` — semântica preservada (extensão NÃO entra aqui).
  //   - `desktopAliveByUser`/`extAliveByUser`: "cliente vivo" (ultimo_visto, pulsa
  //     mesmo ocioso) p/ os selos de monitoração ativa.
  const presencaByUser = new Map<string, number>();
  const desktopAliveByUser = new Map<string, number>();
  const extAliveByUser = new Map<string, number>();
  for (const pr of presenca) {
    const activeTs = pr.ultimo_ativo ? new Date(pr.ultimo_ativo).getTime() : 0;
    const aliveTs = pr.ultimo_visto ? new Date(pr.ultimo_visto).getTime() : 0;
    if (pr.fonte !== "ext" && activeTs > (presencaByUser.get(pr.usuario_id) ?? 0))
      presencaByUser.set(pr.usuario_id, activeTs);
    const aliveBeat = Math.max(activeTs, aliveTs);
    if (pr.fonte === "desktop" && aliveBeat > (desktopAliveByUser.get(pr.usuario_id) ?? 0))
      desktopAliveByUser.set(pr.usuario_id, aliveBeat);
    if (pr.fonte === "ext" && aliveBeat > (extAliveByUser.get(pr.usuario_id) ?? 0))
      extAliveByUser.set(pr.usuario_id, aliveBeat);
  }
  return profiles.map((p) => {
    const myReg = registros.filter((r) => r.usuario_id === p.id);
    // Pega o registro ABERTO mais recente (por inicio). Robusto contra possíveis
    // múltiplos registros sem `fim` (ex.: stale ATIVO não fechado + PAUSA atual).
    const open =
      myReg
        .filter((r) => !r.fim)
        .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0] ?? null;
    const totals = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
    let lastSeen: string | null = null;
    myReg.forEach((r) => {
      const dur =
        r.duracao_minutos ??
        (r.fim
          ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
          : (nowTs - new Date(r.inicio).getTime()) / 60000);
      if (r.status in totals) totals[r.status as keyof typeof totals] += dur;
      const endTime = r.fim ?? r.inicio;
      if (!lastSeen || new Date(endTime) > new Date(lastSeen)) lastSeen = endTime;
    });

    const myApp = navApp.filter((n) => n.usuario_id === p.id);
    const myExt = navExt.filter((n) => n.usuario_id === p.id);
    const myDesk = navDesk.filter((n) => n.usuario_id === p.id);
    const sumSec = (rows: NavRow[]) => rows.reduce((acc, n) => acc + durSec(n, nowTs), 0);

    // Ociosidade RECONCILIADA entre fontes — não conta o mesmo intervalo de
    // relógio mais de uma vez (era a causa do "ócio muito alto"):
    //   - web: só a extensão (navExt). É passive-aware (reunião/vídeo não viram
    //     ócio). Descartamos o ócio do app interno (navApp = navegacao_paginas) e
    //     do chrome.exe do desktop, que cobrem a MESMA janela do navegador.
    //   - apps nativos: só uso_aplicativos NÃO-navegador.
    // Assim "ocioso no desktop (chrome.exe) e ativo no web" deixa de contar.
    const extIdle = myExt.reduce((a, n) => a + (n.inativo_segundos || 0), 0);
    const deskIdle = myDesk
      .filter((n) => !isChromeProcess(n.process_name) && !isChromeProcess(n.app_label))
      .reduce((a, n) => a + (n.inativo_segundos || 0), 0);
    const activeSec = totals.ATIVO * 60;
    const rawIdle = extIdle + deskIdle;
    // Ócio nunca pode exceder o tempo ATIVO monitorado da jornada.
    const idleSeconds = activeSec > 0 ? Math.min(rawIdle, activeSec) : rawIdle;

    // Presença ancorada no ÚLTIMO instante conhecido de atividade — NÃO no
    // `inicio` do segmento aberto. A extensão/desktop mantêm UMA linha aberta
    // por página e só atualizam `duracao_segundos` via heartbeat (~5 min); o
    // `inicio` NÃO muda durante a sessão. Ancorar no `inicio` marcava como
    // offline quem ficasse > 15 min na mesma página (reunião, WhatsApp, doc) —
    // e o avatar ficava preso "Fora do prédio".
    //
    // Liveness do segmento aberto = `inicio + duracao_segundos` (o heartbeat
    // empurra `duracao` para perto de agora; se o cliente trava, `duracao`
    // congela e a presença expira corretamente). Some-se o heartbeat dedicado
    // `presenca_desktop` (~30s), sinal mais confiável p/ apps nativos.
    const PRESENCE_MS = 15 * 60_000;
    const openNavBeat = [...myApp, ...myExt, ...myDesk]
      .filter((n) => !n.fim)
      .reduce(
        (max, n) => Math.max(max, new Date(n.inicio).getTime() + (n.duracao_segundos ?? 0) * 1000),
        0,
      );
    const deskBeat = presencaByUser.get(p.id) ?? 0;
    const lastBeat = Math.max(openNavBeat, deskBeat);
    const hasRecentSignal = lastBeat > 0 && nowTs - lastBeat < PRESENCE_MS;
    const isOnline = !!open || hasRecentSignal;
    const totalOnline = totals.ATIVO + totals.PAUSA + totals.ALMOCO + totals.INATIVO;

    // Monitoração ativa por cliente (selos no avatar): heartbeat "cliente vivo"
    // (ultimo_visto) com fallback no último beat de navegação do cliente antigo.
    const desktopBeat = Math.max(desktopAliveByUser.get(p.id) ?? 0, lastBeatOf(myDesk));
    const extBeat = Math.max(extAliveByUser.get(p.id) ?? 0, lastBeatOf(myExt));
    const desktopActive = desktopBeat > 0 && nowTs - desktopBeat < DESKTOP_ACTIVE_MS;
    const extActive = extBeat > 0 && nowTs - extBeat < EXT_ACTIVE_MS;

    const lastExt = latestOpenOrRecent(myExt);
    const lastUrl =
      lastExt && lastExt.url
        ? {
            url: lastExt.url,
            title: lastExt.title || lastExt.domain || lastExt.url,
            domain: lastExt.domain || "",
            live: isLiveSegment(lastExt, nowTs),
          }
        : null;

    const lastApp = latestOpenOrRecent(myApp);
    const lastAppPage =
      lastApp && lastApp.path ? { path: lastApp.path, title: lastApp.title || lastApp.path } : null;

    const lastDesk = latestOpenOrRecent(myDesk);
    const lastDesktopApp =
      lastDesk && (lastDesk.process_name || lastDesk.app_label)
        ? {
            process: lastDesk.process_name || "",
            label: lastDesk.app_label || lastDesk.process_name || "",
            live: isLiveSegment(lastDesk, nowTs),
          }
        : null;

    return {
      profile: p,
      isAdmin: adminIds.has(p.id),
      isOnline,
      extActive,
      desktopActive,
      currentStatus: open?.status ?? (isOnline ? "ATIVO" : "OFFLINE"),
      currentSince: open?.inicio ?? null,
      totals,
      totalOnline,
      lastSeen,
      navSegSource: { app: sumSec(myApp), ext: sumSec(myExt), desktop: sumSec(myDesk) },
      idleSeconds,
      lastUrl,
      lastAppPage,
      lastDesktopApp,
    };
  });
}

/** Estatísticas agregadas da equipe (reuso do cálculo do painel). */
export function buildStats(snapshots: UserSnapshot[]) {
  const online = snapshots.filter((s) => s.isOnline);
  const byStatus = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
  online.forEach((s) => {
    if (s.currentStatus in byStatus) byStatus[s.currentStatus as keyof typeof byStatus]++;
  });
  return {
    total: snapshots.length,
    online: online.length,
    offline: snapshots.length - online.length,
    ...byStatus,
  };
}
