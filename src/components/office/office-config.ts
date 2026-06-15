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
  | "comercial"
  | "producao"
  | "juridico"
  | "financeiro"
  | "ti"
  | "almoxarifado"
  | "marketing"
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
// Faixa esquerda: SAC/Recepção, Liderança, Espera. Centro: setores (2 linhas).
// Faixa direita: Reunião, Copa, Descanso. Base: Externa (pátio).
export const ROOMS: Record<RoomId, Room> = {
  // ----- Faixa esquerda -----
  recepcao: {
    id: "recepcao",
    label: "SAC / Recepção",
    emoji: "🛎️",
    x: 1,
    y: 1,
    w: 9,
    h: 5,
    tint: "var(--color-info)",
  },
  lideranca: {
    id: "lideranca",
    label: "Liderança",
    emoji: "👔",
    x: 1,
    y: 7,
    w: 9,
    h: 6,
    tint: "var(--color-primary)",
  },
  espera: {
    id: "espera",
    label: "Espera",
    emoji: "🪑",
    x: 1,
    y: 14,
    w: 9,
    h: 5,
    tint: "var(--color-muted-foreground)",
  },

  // ----- Setores (centro): linha 1 -----
  comercial: {
    id: "comercial",
    label: "Comercial",
    emoji: "💼",
    x: 11,
    y: 1,
    w: 5,
    h: 8,
    tint: "var(--color-success)",
  },
  producao: {
    id: "producao",
    label: "Produção",
    emoji: "🛠️",
    x: 17,
    y: 1,
    w: 5,
    h: 8,
    tint: "var(--color-success)",
  },
  juridico: {
    id: "juridico",
    label: "Jurídico",
    emoji: "⚖️",
    x: 23,
    y: 1,
    w: 5,
    h: 8,
    tint: "var(--color-success)",
  },
  financeiro: {
    id: "financeiro",
    label: "Financeiro",
    emoji: "💰",
    x: 29,
    y: 1,
    w: 5,
    h: 8,
    tint: "var(--color-success)",
  },

  // ----- Setores (centro): linha 2 -----
  ti: {
    id: "ti",
    label: "TI",
    emoji: "🖥️",
    x: 11,
    y: 11,
    w: 5,
    h: 8,
    tint: "var(--color-success)",
  },
  almoxarifado: {
    id: "almoxarifado",
    label: "Almoxarifado",
    emoji: "📦",
    x: 17,
    y: 11,
    w: 5,
    h: 8,
    tint: "var(--color-success)",
  },
  marketing: {
    id: "marketing",
    label: "Marketing",
    emoji: "📣",
    x: 23,
    y: 11,
    w: 5,
    h: 8,
    tint: "var(--color-success)",
  },

  // ----- Faixa direita -----
  reuniao: {
    id: "reuniao",
    label: "Sala de Reunião",
    emoji: "📊",
    x: 35,
    y: 1,
    w: 12,
    h: 7,
    tint: "var(--color-accent)",
  },
  copa: {
    id: "copa",
    label: "Copa / Refeitório",
    emoji: "🍽️",
    x: 35,
    y: 9,
    w: 12,
    h: 5,
    tint: "var(--color-info)",
  },
  descanso: {
    id: "descanso",
    label: "Descanso",
    emoji: "☕",
    x: 35,
    y: 15,
    w: 12,
    h: 5,
    tint: "var(--color-warning)",
  },

  // ----- Externa -----
  externa: {
    id: "externa",
    label: "Fora do prédio",
    emoji: "🌳",
    x: 1,
    y: 21,
    w: 46,
    h: 6,
    tint: "var(--color-muted-foreground)",
  },
};

// Portas: células do perímetro que permanecem caminháveis (ligam a sala ao
// corredor). O resto do perímetro vira parede no grid de pathfinding.
export const DOORS: Record<RoomId, Cell[]> = {
  recepcao: [{ cx: 9, cy: 3 }],
  lideranca: [{ cx: 9, cy: 9 }],
  espera: [{ cx: 9, cy: 16 }],
  // Linha 1 dos setores: porta no rodapé, abrindo p/ corredor y=9-10.
  comercial: [{ cx: 13, cy: 8 }],
  producao: [{ cx: 19, cy: 8 }],
  juridico: [{ cx: 25, cy: 8 }],
  financeiro: [{ cx: 31, cy: 8 }],
  // Linha 2 dos setores: porta no topo, abrindo p/ corredor y=9-10.
  ti: [{ cx: 13, cy: 11 }],
  almoxarifado: [{ cx: 19, cy: 11 }],
  marketing: [{ cx: 25, cy: 11 }],
  // Faixa direita: portas voltadas p/ corredor x=34.
  reuniao: [{ cx: 35, cy: 4 }],
  copa: [{ cx: 35, cy: 11 }],
  descanso: [{ cx: 35, cy: 17 }],
  externa: [], // sala aberta (sem paredes)
};

// Salas "abertas" não recebem paredes no grid (área externa = pátio).
export const OPEN_ROOMS: Set<RoomId> = new Set<RoomId>(["externa"]);

export const ROOM_ORDER: RoomId[] = [
  "recepcao",
  "lideranca",
  "espera",
  "comercial",
  "producao",
  "juridico",
  "financeiro",
  "ti",
  "almoxarifado",
  "marketing",
  "reuniao",
  "copa",
  "descanso",
  "externa",
];

// Normaliza valor textual de `departamento` → id da sala de setor.
// Aceita variações comuns (acentos, caixa, "SAC" → recepção, sinônimos).
const DEPT_TO_ROOM: Record<string, RoomId> = {
  comercial: "comercial",
  vendas: "comercial",
  producao: "producao",
  produção: "producao",
  juridico: "juridico",
  jurídico: "juridico",
  legal: "juridico",
  financeiro: "financeiro",
  financas: "financeiro",
  finanças: "financeiro",
  ti: "ti",
  tecnologia: "ti",
  "tecnologia da informacao": "ti",
  "tecnologia da informação": "ti",
  it: "ti",
  almoxarifado: "almoxarifado",
  estoque: "almoxarifado",
  marketing: "marketing",
  mkt: "marketing",
  sac: "recepcao",
  recepcao: "recepcao",
  recepção: "recepcao",
  atendimento: "recepcao",
};

function deptRoom(dep: string | null | undefined): RoomId | null {
  if (!dep) return null;
  const k = dep.trim().toLowerCase();
  return DEPT_TO_ROOM[k] ?? null;
}

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

/** Sala-destino de um colaborador conforme status atual (+ setor). */
export function roomForSnapshot(s: UserSnapshot): RoomId {
  // Offline = fora do prédio, independente de perfil.
  if (!s.isOnline) return "externa";

  // Admin online vai para a sala de liderança.
  if (s.isAdmin) return "lideranca";

  // Online mas sem registro de expediente aberto — logou mas não iniciou jornada.
  if (!s.currentSince) return "espera";

  // Sala-base = setor do colaborador (fallback espera quando não cadastrado).
  const sectorRoom = deptRoom(s.profile.departamento) ?? "espera";

  switch (s.currentStatus) {
    case "ATIVO":
      return isMeeting(s) ? "reuniao" : sectorRoom;
    case "INATIVO":
      return sectorRoom; // dormindo na própria mesa do setor
    case "PAUSA":
      return "descanso";
    case "ALMOCO":
      return "copa";
    case "ENCERRADO":
      // Encerrou o expediente mas continua navegando — fica na recepção.
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
