// Configuração do "escritório virtual": layout das salas em coordenadas de
// células (grid lógico), mapeamento status→sala, detecção heurística de reunião
// e empacotamento determinístico de avatares dentro de cada sala.
//
// O mundo é um grid de WORLD.cols x WORLD.rows células. Posições são convertidas
// em percentuais (left/top) na renderização, então o ambiente é responsivo:
// o container mantém o aspect-ratio e os avatares acompanham a escala.
//
// Layout em DOIS andares (rola para baixo): andar de cima com setores +
// utilidades; andar de baixo com treinamento, auditório, banheiros, vestiário,
// estacionamento e jardim externo.

import type { UserSnapshot } from "@/lib/operacional-snapshot";

export const WORLD = { cols: 48, rows: 48 };

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
  | "estacionamento"
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

// Layout em um único andar (prédio em y=1..29), com estacionamento (y=30..36)
// e jardim externo (y=37..47) logo abaixo. Coordenadas calibradas para
// baterem com o mapa em src/assets/office-map.jpg.
export const ROOMS: Record<RoomId, Room> = {
  // ===== Linha de cima (rows 1-8) =====
  recepcao: { id: "recepcao", label: "SAC / Recepção", emoji: "🛎️", x: 1, y: 1, w: 9, h: 8, tint: "var(--color-info)" },
  comercial: { id: "comercial", label: "Comercial", emoji: "💼", x: 10, y: 1, w: 8, h: 8, tint: "var(--color-success)" },
  juridico: { id: "juridico", label: "Jurídico", emoji: "⚖️", x: 18, y: 1, w: 9, h: 8, tint: "var(--color-success)" },
  financeiro: { id: "financeiro", label: "Financeiro", emoji: "💰", x: 27, y: 1, w: 8, h: 8, tint: "var(--color-success)" },
  reuniao: { id: "reuniao", label: "Sala de Reunião", emoji: "📊", x: 35, y: 1, w: 12, h: 11, tint: "var(--color-accent)" },

  // ===== Faixa do meio (rows 9-20) — Produção de Eventos é a maior =====
  lideranca: { id: "lideranca", label: "Liderança", emoji: "👔", x: 1, y: 9, w: 9, h: 12, tint: "var(--color-primary)" },
  producao: { id: "producao", label: "Produção de Eventos", emoji: "🎪", x: 10, y: 9, w: 25, h: 12, tint: "var(--color-success)" },
  copa: { id: "copa", label: "Copa / Refeitório", emoji: "🍽️", x: 35, y: 12, w: 12, h: 9, tint: "var(--color-info)" },

  // ===== Linha de baixo (rows 21-29) — TI expandida =====
  espera: { id: "espera", label: "Espera", emoji: "🪑", x: 1, y: 21, w: 5, h: 8, tint: "var(--color-muted-foreground)" },
  ti: { id: "ti", label: "TI", emoji: "🖥️", x: 6, y: 21, w: 18, h: 8, tint: "var(--color-success)" },
  almoxarifado: { id: "almoxarifado", label: "Almoxarifado", emoji: "📦", x: 24, y: 21, w: 6, h: 8, tint: "var(--color-success)" },
  marketing: { id: "marketing", label: "Marketing", emoji: "📣", x: 30, y: 21, w: 6, h: 8, tint: "var(--color-success)" },
  descanso: { id: "descanso", label: "Descanso", emoji: "☕", x: 36, y: 21, w: 11, h: 8, tint: "var(--color-warning)" },

  // ===== Áreas externas =====
  estacionamento: { id: "estacionamento", label: "Estacionamento", emoji: "🅿️", x: 1, y: 30, w: 46, h: 7, tint: "var(--color-muted-foreground)" },
  externa: { id: "externa", label: "Jardim / Fora do prédio", emoji: "🌳", x: 1, y: 37, w: 46, h: 10, tint: "var(--color-success)" },
};

// Portas: células do perímetro que permanecem caminháveis (ligam a sala ao
// corredor). O resto do perímetro vira parede no grid de pathfinding.
export const DOORS: Record<RoomId, Cell[]> = {
  recepcao: [{ cx: 10, cy: 4 }],
  comercial: [{ cx: 14, cy: 9 }],
  juridico: [{ cx: 22, cy: 9 }],
  financeiro: [{ cx: 31, cy: 9 }],
  reuniao: [{ cx: 35, cy: 6 }],
  lideranca: [{ cx: 10, cy: 15 }],
  producao: [{ cx: 22, cy: 20 }],
  copa: [{ cx: 35, cy: 16 }],
  espera: [{ cx: 10, cy: 25 }],
  ti: [{ cx: 14, cy: 21 }],
  almoxarifado: [{ cx: 22, cy: 21 }],
  marketing: [{ cx: 31, cy: 21 }],
  descanso: [{ cx: 35, cy: 25 }],
  estacionamento: [{ cx: 24, cy: 30 }],
  externa: [],
};

// Salas "abertas" não recebem paredes no grid (pátio externo).
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
  "estacionamento",
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
