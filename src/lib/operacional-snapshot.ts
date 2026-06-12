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
  ultimo_ativo: string;
};

export interface UserSnapshot {
  profile: Profile;
  isOnline: boolean;
  currentStatus: string;
  currentSince: string | null;
  totals: { ATIVO: number; PAUSA: number; ALMOCO: number; INATIVO: number };
  totalOnline: number;
  lastSeen: string | null;
  navSegSource: { app: number; ext: number; desktop: number };
  idleSeconds: number;
  lastUrl: { url: string; title: string; domain: string } | null;
  lastAppPage: { path: string; title: string } | null;
  /** Último app desktop em foco (process_name/app_label), p/ detecção de reunião. */
  lastDesktopApp: { process: string; label: string } | null;
}

function durSec(n: NavRow, nowTs: number): number {
  const d =
    n.duracao_segundos ??
    (n.fim
      ? (new Date(n.fim).getTime() - new Date(n.inicio).getTime()) / 1000
      : (nowTs - new Date(n.inicio).getTime()) / 1000);
  return Math.max(0, d);
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
): UserSnapshot[] {
  // Heartbeat desktop por usuário (último por `ultimo_ativo`).
  const presencaByUser = new Map<string, number>();
  for (const pr of presenca) {
    const ts = new Date(pr.ultimo_ativo).getTime();
    const prev = presencaByUser.get(pr.usuario_id) ?? 0;
    if (ts > prev) presencaByUser.set(pr.usuario_id, ts);
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

    const lastExt = latestOpenOrRecent(myExt);
    const lastUrl =
      lastExt && lastExt.url
        ? {
            url: lastExt.url,
            title: lastExt.title || lastExt.domain || lastExt.url,
            domain: lastExt.domain || "",
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
          }
        : null;

    return {
      profile: p,
      isOnline,
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
