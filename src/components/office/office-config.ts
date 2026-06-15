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
  | "treinamento"
  | "auditorio"
  | "banheiro_m"
  | "banheiro_f"
  | "vestiario"
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
  /**
   * "Mobília" decorativa renderizada no rodapé interno da sala — apenas para
   * dar contexto visual (não interage com pathfinding nem com avatares).
   */
  furniture?: string[];
}

// Andar 1 (y=1..19) — entrada, setores, reunião/copa/descanso.
// Corredor y=20..21 separa os andares.
// Andar 2 (y=22..41) — treinamento, auditório, banheiros, vestiário, estacionamento.
// Jardim externo (y=43..47) — pátio aberto onde ficam os offline.
// Coordenadas calibradas (em células de 48×48) para baterem com o desenho
// do mapa em src/assets/office-map.jpg.
export const ROOMS: Record<RoomId, Room> = {
  // ===== Andar 1 — coluna esquerda =====
  recepcao: { id: "recepcao", label: "SAC / Recepção", emoji: "🛎️", x: 1, y: 1, w: 12, h: 8, tint: "var(--color-info)" },
  lideranca: { id: "lideranca", label: "Liderança", emoji: "👔", x: 1, y: 9, w: 12, h: 7, tint: "var(--color-primary)" },
  espera: { id: "espera", label: "Espera", emoji: "🪑", x: 1, y: 16, w: 12, h: 5, tint: "var(--color-muted-foreground)" },

  // ===== Andar 1 — setores centrais, linha 1 =====
  comercial: { id: "comercial", label: "Comercial", emoji: "💼", x: 14, y: 1, w: 5, h: 9, tint: "var(--color-success)" },
  producao: { id: "producao", label: "Produção", emoji: "🛠️", x: 19, y: 1, w: 5, h: 9, tint: "var(--color-success)" },
  juridico: { id: "juridico", label: "Jurídico", emoji: "⚖️", x: 24, y: 1, w: 6, h: 9, tint: "var(--color-success)" },
  financeiro: { id: "financeiro", label: "Financeiro", emoji: "💰", x: 30, y: 1, w: 4, h: 9, tint: "var(--color-success)" },

  // ===== Andar 1 — setores centrais, linha 2 =====
  ti: { id: "ti", label: "TI", emoji: "🖥️", x: 14, y: 11, w: 5, h: 10, tint: "var(--color-success)" },
  almoxarifado: { id: "almoxarifado", label: "Almoxarifado", emoji: "📦", x: 19, y: 11, w: 7, h: 10, tint: "var(--color-success)" },
  marketing: { id: "marketing", label: "Marketing", emoji: "📣", x: 26, y: 11, w: 8, h: 10, tint: "var(--color-success)" },

  // ===== Andar 1 — coluna direita =====
  reuniao: { id: "reuniao", label: "Sala de Reunião", emoji: "📊", x: 35, y: 1, w: 12, h: 8, tint: "var(--color-accent)" },
  copa: { id: "copa", label: "Copa / Refeitório", emoji: "🍽️", x: 35, y: 9, w: 12, h: 7, tint: "var(--color-info)" },
  descanso: { id: "descanso", label: "Descanso", emoji: "☕", x: 35, y: 16, w: 12, h: 5, tint: "var(--color-warning)" },

  // ===== Andar 2 — utilidades =====
  vestiario: { id: "vestiario", label: "Vestiário", emoji: "👕", x: 1, y: 22, w: 11, h: 10, tint: "var(--color-muted-foreground)" },
  treinamento: { id: "treinamento", label: "Sala de Treinamento", emoji: "🎓", x: 13, y: 22, w: 13, h: 10, tint: "var(--color-primary)" },
  auditorio: { id: "auditorio", label: "Auditório", emoji: "🎤", x: 27, y: 22, w: 10, h: 10, tint: "var(--color-accent)" },
  banheiro_m: { id: "banheiro_m", label: "Banheiro M", emoji: "🚹", x: 38, y: 22, w: 9, h: 5, tint: "var(--color-info)" },
  banheiro_f: { id: "banheiro_f", label: "Banheiro F", emoji: "🚺", x: 38, y: 27, w: 9, h: 5, tint: "var(--color-destructive)" },

  // ===== Estacionamento (faixa horizontal) =====
  estacionamento: { id: "estacionamento", label: "Estacionamento", emoji: "🅿️", x: 1, y: 33, w: 46, h: 8, tint: "var(--color-muted-foreground)" },

  // ===== Jardim externo (pátio aberto) =====
  externa: { id: "externa", label: "Jardim / Fora do prédio", emoji: "🌳", x: 1, y: 42, w: 46, h: 5, tint: "var(--color-success)" },
};

// Portas: células do perímetro que permanecem caminháveis (ligam a sala ao
// corredor). O resto do perímetro vira parede no grid de pathfinding.
export const DOORS: Record<RoomId, Cell[]> = {
  // Andar 1
  recepcao: [{ cx: 12, cy: 5 }],
  lideranca: [{ cx: 12, cy: 12 }],
  espera: [{ cx: 12, cy: 18 }],
  comercial: [{ cx: 16, cy: 9 }],
  producao: [{ cx: 21, cy: 9 }],
  juridico: [{ cx: 26, cy: 9 }],
  financeiro: [{ cx: 31, cy: 9 }],
  ti: [{ cx: 16, cy: 11 }],
  almoxarifado: [{ cx: 22, cy: 11 }],
  marketing: [{ cx: 29, cy: 11 }],
  reuniao: [{ cx: 35, cy: 5 }],
  copa: [{ cx: 35, cy: 12 }],
  descanso: [{ cx: 35, cy: 18 }],
  // Andar 2
  vestiario: [{ cx: 11, cy: 27 }],
  treinamento: [{ cx: 19, cy: 22 }],
  auditorio: [{ cx: 31, cy: 22 }],
  banheiro_m: [{ cx: 38, cy: 24 }],
  banheiro_f: [{ cx: 38, cy: 29 }],
  estacionamento: [{ cx: 24, cy: 33 }],
  // Pátio aberto
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
  "vestiario",
  "treinamento",
  "auditorio",
  "banheiro_m",
  "banheiro_f",
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
