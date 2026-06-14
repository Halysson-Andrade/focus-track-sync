// Configuração do "escritório virtual": layout das salas em coordenadas de
// células (grid lógico), mapeamento status→sala, detecção heurística de reunião
// e empacotamento determinístico de avatares dentro de cada sala.
//
// O mundo é um grid de WORLD.cols x WORLD.rows células. Posições são convertidas
// em percentuais (left/top) na renderização, então o ambiente é responsivo:
// o container mantém o aspect-ratio e os avatares acompanham a escala.

import type { UserSnapshot } from "@/lib/operacional-snapshot";

export const WORLD = { cols: 48, rows: 28 };

export type RoomId =
  | "recepcao"
  | "espera"
  | "trabalho"
  | "reuniao"
  | "copa"
  | "descanso"
  | "lideranca"
  | "externa";

export interface Room {
  id: RoomId;
  label: string;
  emoji: string;
  /** Retângulo em células: canto superior-esquerdo (x,y) + largura/altura. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Token de cor (CSS var) usado no fundo translúcido da sala. */
  tint: string;
}

// Layout (48 x 28). Corredores = espaço não ocupado entre as salas.
export const ROOMS: Record<RoomId, Room> = {
  recepcao: {
    id: "recepcao",
    label: "Recepção",
    emoji: "🛎️",
    x: 1,
    y: 1,
    w: 9,
    h: 6,
    tint: "var(--color-info)",
  },
  lideranca: {
    id: "lideranca",
    label: "Liderança",
    emoji: "👔",
    x: 1,
    y: 8,
    w: 9,
    h: 8,
    tint: "var(--color-primary)",
  },
  espera: {
    id: "espera",
    label: "Espera",
    emoji: "🪑",
    x: 1,
    y: 17,
    w: 9,
    h: 4,
    tint: "var(--color-muted-foreground)",
  },

  trabalho: {
    id: "trabalho",
    label: "Área de Trabalho",
    emoji: "💻",
    x: 11,
    y: 1,
    w: 22,
    h: 20,
    tint: "var(--color-success)",
  },
  reuniao: {
    id: "reuniao",
    label: "Sala de Reunião",
    emoji: "📊",
    x: 34,
    y: 1,
    w: 13,
    h: 8,
    tint: "var(--color-accent)",
  },
  copa: {
    id: "copa",
    label: "Copa / Refeitório",
    emoji: "🍽️",
    x: 34,
    y: 10,
    w: 13,
    h: 5,
    tint: "var(--color-info)",
  },
  descanso: {
    id: "descanso",
    label: "Descanso",
    emoji: "☕",
    x: 34,
    y: 16,
    w: 13,
    h: 5,
    tint: "var(--color-warning)",
  },
  externa: {
    id: "externa",
    label: "Fora do prédio",
    emoji: "🌳",
    x: 1,
    y: 22,
    w: 46,
    h: 5,
    tint: "var(--color-muted-foreground)",
  },
};

// Portas: células do perímetro que permanecem caminháveis (ligam a sala ao
// corredor). O resto do perímetro vira parede no grid de pathfinding.
export const DOORS: Record<RoomId, Cell[]> = {
  recepcao: [{ cx: 9, cy: 3 }],
  lideranca: [{ cx: 9, cy: 10 }],
  espera: [{ cx: 9, cy: 19 }],
  trabalho: [
    { cx: 11, cy: 5 },
    { cx: 11, cy: 15 },
    { cx: 32, cy: 5 },
    { cx: 22, cy: 20 },
  ],
  reuniao: [{ cx: 34, cy: 4 }],
  copa: [{ cx: 34, cy: 12 }],
  descanso: [{ cx: 34, cy: 18 }],
  externa: [], // sala aberta (sem paredes)
};

// Salas "abertas" não recebem paredes no grid (área externa = pátio).
export const OPEN_ROOMS: Set<RoomId> = new Set<RoomId>(["externa"]);

export const ROOM_ORDER: RoomId[] = [
  "recepcao",
  "lideranca",
  "espera",
  "trabalho",
  "reuniao",
  "copa",
  "descanso",
  "externa",
];

// --- Detecção de reunião (heurística sobre app/URL já capturados) ---
// Só processos EXCLUSIVOS de chamada. Teams/Discord ficam sempre abertos em
// segundo plano (chat), então geravam falso positivo por processo — Teams é
// detectado pela URL (teams.microsoft.com), que indica estar na chamada.
const MEETING_PROCESS = ["zoom", "webex"];
const MEETING_DOMAINS = [
  "meet.google.com",
  "teams.microsoft.com",
  "teams.live.com",
  "zoom.us",
  "whereby.com",
  "webex.com",
  "meet.jit.si",
];

/**
 * Reunião só quando o sinal está VIVO (segmento em foco agora, via flag `live`),
 * não por app/aba esquecido em segundo plano. Exige também status ATIVO.
 */
export function isMeeting(s: UserSnapshot): boolean {
  if (s.currentStatus !== "ATIVO") return false;
  if (s.lastDesktopApp?.live) {
    const proc = `${s.lastDesktopApp.process} ${s.lastDesktopApp.label}`.toLowerCase();
    if (MEETING_PROCESS.some((k) => proc.includes(k))) return true;
  }
  if (s.lastUrl?.live) {
    const dom = s.lastUrl.domain.toLowerCase();
    if (dom && MEETING_DOMAINS.some((d) => dom === d || dom.endsWith("." + d))) return true;
  }
  return false;
}

/** Sala-destino de um colaborador conforme status atual (+ reunião derivada). */
export function roomForSnapshot(s: UserSnapshot): RoomId {
  // Admin SEMPRE na Liderança, mesmo sem expediente iniciado ou sem sinal
  // recente — a liderança é considerada presente enquanto a conta existir.
  if (s.isAdmin) return "lideranca";
  // Só vai pro "externa" (fora do prédio) quando o colaborador realmente
  // está offline. Se ainda há sinal de presença (registro aberto ou navegação
  // recente), ele aparece DENTRO do escritório conforme o status.
  if (!s.isOnline) return "externa";

  // Online mas sem registro de expediente aberto (currentSince null) —
  // logou no sistema/desktop mas ainda não iniciou a jornada. Vai pra espera.
  if (!s.currentSince) return "espera";
  switch (s.currentStatus) {
    case "ATIVO":
      return isMeeting(s) ? "reuniao" : "trabalho";
    case "INATIVO":
      return "trabalho"; // dormindo na própria mesa
    case "PAUSA":
      return "descanso";
    case "ALMOCO":
      return "copa";
    case "ENCERRADO":
      // Encerrou o expediente mas continua navegando — fica na recepção
      // (saindo do prédio) em vez de pular pra área externa.
      return "recepcao";
    default:
      return "espera";
  }
}

export interface Cell {
  cx: number;
  cy: number;
}

/**
 * Empacota `count` avatares dentro de uma sala, em grade, retornando os centros
 * de célula (cx,cy). Determinístico em função de (sala, índice, total).
 */
export function packPositions(room: Room, count: number): Cell[] {
  if (count <= 0) return [];
  const padX = Math.min(1.5, room.w / 4);
  const padY = Math.min(1.5, room.h / 4);
  const innerX = room.x + padX;
  const innerY = room.y + padY + 0.6; // espaço p/ rótulo no topo
  const innerW = room.w - padX * 2;
  const innerH = room.h - padY * 2 - 0.6;
  const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * (innerW / innerH)))));
  const rows = Math.ceil(count / cols);
  const stepX = innerW / cols;
  const stepY = innerH / Math.max(1, rows);
  const cells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // centraliza a última linha quando incompleta
    const itemsInRow = r === rows - 1 ? count - r * cols : cols;
    const rowOffset = (cols - itemsInRow) / 2;
    cells.push({
      cx: innerX + (c + rowOffset + 0.5) * stepX,
      cy: innerY + (r + 0.5) * stepY,
    });
  }
  return cells;
}

/** Hash estável de string → inteiro (para ordenar/semear posições). */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface PlacedAvatar {
  snapshot: UserSnapshot;
  room: RoomId;
  cell: Cell;
}

/**
 * Distribui todos os snapshots em suas salas-destino, com posições estáveis
 * (ordenadas por hash do id) para minimizar "saltos" entre re-renders.
 */
export function placeAvatars(snapshots: UserSnapshot[]): PlacedAvatar[] {
  const byRoom = new Map<RoomId, UserSnapshot[]>();
  for (const s of snapshots) {
    const room = roomForSnapshot(s);
    const arr = byRoom.get(room) ?? [];
    arr.push(s);
    byRoom.set(room, arr);
  }
  const placed: PlacedAvatar[] = [];
  for (const [roomId, arr] of byRoom) {
    arr.sort((a, b) => hashId(a.profile.id) - hashId(b.profile.id));
    const cells = packPositions(ROOMS[roomId], arr.length);
    arr.forEach((s, i) => placed.push({ snapshot: s, room: roomId, cell: cells[i] }));
  }
  return placed;
}

/** Conta avatares por sala (para heatmap / densidade). */
export function densityByRoom(snapshots: UserSnapshot[]): Record<RoomId, number> {
  const out = Object.fromEntries(ROOM_ORDER.map((r) => [r, 0])) as Record<RoomId, number>;
  for (const s of snapshots) out[roomForSnapshot(s)]++;
  return out;
}
