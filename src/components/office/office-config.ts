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
   * Célula reservada para o "líder" do setor (mesa própria dentro da sala).
   * Coordenada ABSOLUTA (não relativa). Se ausente, a sala não tem cadeira
   * exclusiva de líder e admins caem no packing normal.
   */
  leaderSeat?: Cell;
}

// Layout reformado — salas maiores; Liderança foi removida (líderes agora
// ocupam uma "mesa do chefe" dentro do próprio setor via `leaderSeat`).
// Coordenadas casam com src/assets/office-map.jpg (regenerado).
export const ROOMS: Record<RoomId, Room> = {
  // ===== Andar de cima (rows 0-14) — SAC e Financeiro ganharam largura =====
  recepcao:   { id: "recepcao",   label: "SAC / Recepção", emoji: "🛎️", x:  0, y:  0, w: 12, h: 14, tint: "var(--color-info)",    leaderSeat: { cx:  2.5, cy:  2.5 } },
  comercial:  { id: "comercial",  label: "Comercial",       emoji: "💼", x: 12, y:  0, w: 10, h: 14, tint: "var(--color-success)", leaderSeat: { cx: 14.5, cy:  2.5 } },
  juridico:   { id: "juridico",   label: "Jurídico",        emoji: "⚖️", x: 22, y:  0, w:  9, h: 14, tint: "var(--color-success)", leaderSeat: { cx: 24.5, cy:  2.5 } },
  financeiro: { id: "financeiro", label: "Financeiro",      emoji: "💰", x: 31, y:  0, w: 11, h: 14, tint: "var(--color-success)", leaderSeat: { cx: 33.5, cy:  2.5 } },
  reuniao:    { id: "reuniao",    label: "Sala de Reunião", emoji: "📊", x: 42, y:  0, w:  6, h: 14, tint: "var(--color-accent)" },

  // ===== Faixa do meio (rows 14-24) — Produção e Refeitório enormes =====
  producao:   { id: "producao",   label: "Produção de Eventos", emoji: "🎪", x:  0, y: 14, w: 24, h: 10, tint: "var(--color-success)", leaderSeat: { cx:  2.5, cy: 16.5 } },
  copa:       { id: "copa",       label: "Copa / Refeitório",   emoji: "🍽️", x: 24, y: 14, w: 24, h: 10, tint: "var(--color-info)" },

  // ===== Andar de baixo (rows 24-33) — TI ampliada =====
  espera:        { id: "espera",        label: "Espera",       emoji: "🪑", x:  0, y: 24, w:  5, h:  9, tint: "var(--color-muted-foreground)" },
  ti:            { id: "ti",            label: "TI",           emoji: "🖥️", x:  5, y: 24, w: 20, h:  9, tint: "var(--color-success)", leaderSeat: { cx:  7.5, cy: 26.0 } },
  almoxarifado:  { id: "almoxarifado",  label: "Almoxarifado", emoji: "📦", x: 25, y: 24, w:  6, h:  9, tint: "var(--color-success)" },
  marketing:     { id: "marketing",     label: "Marketing",    emoji: "📣", x: 31, y: 24, w:  7, h:  9, tint: "var(--color-success)", leaderSeat: { cx: 33.0, cy: 26.0 } },
  descanso:      { id: "descanso",      label: "Descanso",     emoji: "☕", x: 38, y: 24, w: 10, h:  9, tint: "var(--color-warning)" },

  // ===== Áreas externas =====
  estacionamento: { id: "estacionamento", label: "Estacionamento",          emoji: "🅿️", x: 0, y: 33, w: 48, h:  5, tint: "var(--color-muted-foreground)" },
  externa:        { id: "externa",        label: "Jardim / Fora do prédio", emoji: "🌳", x: 0, y: 38, w: 48, h: 10, tint: "var(--color-success)" },
};

// Portas: células do perímetro que permanecem caminháveis (ligam a sala ao
// corredor/sala adjacente). O restante do perímetro vira parede.
export const DOORS: Record<RoomId, Cell[]> = {
  recepcao:       [{ cx:  6, cy: 14 }],
  comercial:      [{ cx: 17, cy: 14 }],
  juridico:       [{ cx: 26, cy: 14 }],
  financeiro:     [{ cx: 36, cy: 14 }],
  reuniao:        [{ cx: 45, cy: 14 }],
  producao:       [{ cx: 12, cy: 24 }],
  copa:           [{ cx: 36, cy: 24 }],
  espera:         [{ cx:  2, cy: 24 }],
  ti:             [{ cx: 15, cy: 24 }],
  almoxarifado:   [{ cx: 28, cy: 24 }],
  marketing:      [{ cx: 34, cy: 24 }],
  descanso:       [{ cx: 42, cy: 24 }],
  estacionamento: [{ cx: 24, cy: 33 }],
  externa:        [],
};

// Salas "abertas" não recebem paredes no grid (pátio externo).
export const OPEN_ROOMS: Set<RoomId> = new Set<RoomId>(["externa"]);

export const ROOM_ORDER: RoomId[] = [
  "recepcao",
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

/** Opções canônicas de departamento (valor salvo em profiles.departamento). */
export const DEPARTAMENTOS: Array<{ value: string; label: string }> = [
  { value: "comercial", label: "Comercial" },
  { value: "producao", label: "Produção de Eventos" },
  { value: "juridico", label: "Jurídico" },
  { value: "financeiro", label: "Financeiro" },
  { value: "ti", label: "TI" },
  { value: "almoxarifado", label: "Almoxarifado" },
  { value: "marketing", label: "Marketing" },
  { value: "sac", label: "SAC / Recepção" },
];

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
