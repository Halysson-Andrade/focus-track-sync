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

export const WORLD = { cols: 48, rows: 60 };

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
  | "diretoria"
  | "rh"
  | "treinamento"
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
  /**
   * Nº esperado de mesas do setor (sem contar o líder). Dimensiona um layout
   * ESTÁTICO de posições — cada colaborador senta sempre na mesma mesa,
   * evitando "salto" entre re-renders. Se `undefined`, cai no packing dinâmico.
   */
  capacity?: number;
}

// Layout reformado (world 48×60): 4 fileiras de departamentos + refeitório
// central + descanso + área externa (estacionamento + jardim). Cada setor
// tem `capacity` = nº aproximado de mesas (informado pelo cliente) e
// `leaderSeat` = mesa exclusiva do líder no canto da sala.
// Coordenadas casam com src/assets/office-map.jpg.
export const ROOMS: Record<RoomId, Room> = {
  // ===== Fileira 1 (rows 0-14) — SAC/Comercial/Jurídico/Financeiro/Reunião =====
  recepcao:   { id: "recepcao",   label: "SAC / Recepção",  emoji: "🛎️", x:  0, y:  0, w: 12, h: 14, tint: "var(--color-info)",    leaderSeat: { cx:  2.5, cy:  2.5 }, capacity:  5 },
  comercial:  { id: "comercial",  label: "Comercial",       emoji: "💼", x: 12, y:  0, w: 10, h: 14, tint: "var(--color-success)", leaderSeat: { cx: 14.5, cy:  2.5 }, capacity:  1 },
  juridico:   { id: "juridico",   label: "Jurídico",        emoji: "⚖️", x: 22, y:  0, w:  9, h: 14, tint: "var(--color-success)", leaderSeat: { cx: 24.5, cy:  2.5 }, capacity:  1 },
  financeiro: { id: "financeiro", label: "Financeiro",      emoji: "💰", x: 31, y:  0, w: 11, h: 14, tint: "var(--color-success)", leaderSeat: { cx: 33.5, cy:  2.5 }, capacity:  4 },
  reuniao:    { id: "reuniao",    label: "Sala de Reunião", emoji: "📊", x: 42, y:  0, w:  6, h: 14, tint: "var(--color-accent)" },

  // ===== Fileira 2 (rows 14-24) — Produção e Refeitório enormes =====
  producao:   { id: "producao",   label: "Produção de Eventos", emoji: "🎪", x:  0, y: 14, w: 24, h: 10, tint: "var(--color-success)", leaderSeat: { cx:  2.5, cy: 16.5 }, capacity: 20 },
  copa:       { id: "copa",       label: "Copa / Refeitório",   emoji: "🍽️", x: 24, y: 14, w: 24, h: 10, tint: "var(--color-info)" },

  // ===== Fileira 3 (rows 24-33) — Espera / TI / Almoxarifado / Marketing / Descanso =====
  espera:        { id: "espera",        label: "Espera",       emoji: "🪑", x:  0, y: 24, w:  5, h:  9, tint: "var(--color-muted-foreground)" },
  ti:            { id: "ti",            label: "TI",           emoji: "🖥️", x:  5, y: 24, w: 20, h:  9, tint: "var(--color-success)", leaderSeat: { cx:  7.5, cy: 26.0 }, capacity: 6 },
  almoxarifado:  { id: "almoxarifado",  label: "Almoxarifado", emoji: "📦", x: 25, y: 24, w:  6, h:  9, tint: "var(--color-success)" },
  marketing:     { id: "marketing",     label: "Marketing",    emoji: "📣", x: 31, y: 24, w:  7, h:  9, tint: "var(--color-success)", leaderSeat: { cx: 33.0, cy: 26.0 }, capacity: 3 },
  descanso:      { id: "descanso",      label: "Descanso",     emoji: "☕", x: 38, y: 24, w: 10, h:  9, tint: "var(--color-warning)" },

  // ===== Fileira 4 (rows 33-45) — NOVA: Diretoria / RH / Treinamento =====
  diretoria:   { id: "diretoria",   label: "Diretoria",   emoji: "🏛️", x:  0, y: 33, w: 18, h: 12, tint: "var(--color-primary)", leaderSeat: { cx:  2.5, cy: 35.5 } },
  rh:          { id: "rh",          label: "RH",          emoji: "🤝", x: 18, y: 33, w: 14, h: 12, tint: "var(--color-info)" },
  treinamento: { id: "treinamento", label: "Treinamento", emoji: "🎓", x: 32, y: 33, w: 16, h: 12, tint: "var(--color-accent)" },

  // ===== Áreas externas =====
  estacionamento: { id: "estacionamento", label: "Estacionamento",          emoji: "🅿️", x: 0, y: 45, w: 48, h:  5, tint: "var(--color-muted-foreground)" },
  externa:        { id: "externa",        label: "Jardim / Fora do prédio", emoji: "🌳", x: 0, y: 50, w: 48, h: 10, tint: "var(--color-success)" },
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
  ti:             [{ cx: 15, cy: 24 }, { cx: 15, cy: 33 }],
  almoxarifado:   [{ cx: 28, cy: 24 }],
  marketing:      [{ cx: 34, cy: 24 }, { cx: 34, cy: 33 }],
  descanso:       [{ cx: 42, cy: 24 }],
  diretoria:      [{ cx:  9, cy: 33 }, { cx:  9, cy: 45 }],
  rh:             [{ cx: 25, cy: 33 }, { cx: 25, cy: 45 }],
  treinamento:    [{ cx: 40, cy: 33 }, { cx: 40, cy: 45 }],
  estacionamento: [{ cx: 24, cy: 45 }],
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
  "diretoria",
  "rh",
  "treinamento",
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
  diretoria: "diretoria",
  diretor: "diretoria",
  direcao: "diretoria",
  direção: "diretoria",
  rh: "rh",
  "recursos humanos": "rh",
  treinamento: "treinamento",
  "sala de treinamento": "treinamento",
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
  { value: "diretoria", label: "Diretoria" },
  { value: "rh", label: "RH" },
  { value: "treinamento", label: "Treinamento" },
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

  // Sala-base = setor do colaborador. Admins sem setor caem no SAC.
  // Líderes (admins) ficam no próprio setor — ocupam a `leaderSeat` na hora
  // de posicionar o avatar (ver placeAvatars).
  const sectorRoom = deptRoom(s.profile.departamento) ?? (s.isAdmin ? "recepcao" : "espera");

  // Online mas sem expediente aberto — logou mas não iniciou jornada.
  if (!s.currentSince) return s.isAdmin ? sectorRoom : "espera";

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
    const room = ROOMS[roomId];
    // Separa o líder (admin) — se a sala tem `leaderSeat`, ele senta lá.
    // Só um líder por sala (o de menor hash, para ficar estável).
    let leader: UserSnapshot | null = null;
    let rest = arr;
    if (room.leaderSeat) {
      const admins = arr.filter((s) => s.isAdmin);
      if (admins.length > 0) {
        admins.sort((a, b) => hashId(a.profile.id) - hashId(b.profile.id));
        leader = admins[0];
        rest = arr.filter((s) => s.profile.id !== leader!.profile.id);
      }
    }
    rest.sort((a, b) => hashId(a.profile.id) - hashId(b.profile.id));
    const cells = packPositions(room, rest.length);
    rest.forEach((s, i) => placed.push({ snapshot: s, room: roomId, cell: cells[i] }));
    if (leader && room.leaderSeat) {
      placed.push({ snapshot: leader, room: roomId, cell: room.leaderSeat });
    }
  }
  return placed;
}

/** Conta avatares por sala (para heatmap / densidade). */
export function densityByRoom(snapshots: UserSnapshot[]): Record<RoomId, number> {
  const out = Object.fromEntries(ROOM_ORDER.map((r) => [r, 0])) as Record<RoomId, number>;
  for (const s of snapshots) out[roomForSnapshot(s)]++;
  return out;
}
