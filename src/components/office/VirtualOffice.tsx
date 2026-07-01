import { useMemo, useState } from "react";
import type { UserSnapshot } from "@/lib/operacional-snapshot";
import { useAvatarMovement } from "@/hooks/use-avatar-movement";
import { ManagerHud } from "./ManagerHud";
import { OfficeAvatar } from "./OfficeAvatar";
import { buildWalkGrid, type WalkGrid } from "./pathfinding";
import {
  ROOM_ORDER,
  ROOMS,
  WORLD,
  densityByRoom,
  placeAvatars,
  type Cell,
  type Room,
  type RoomId,
} from "./office-config";
import { Flame } from "lucide-react";
import officeMap from "@/assets/office-map.jpg";

interface Stats {
  total: number;
  online: number;
  offline: number;
  ATIVO: number;
  PAUSA: number;
  ALMOCO: number;
  INATIVO: number;
}

interface Props {
  snapshots: UserSnapshot[];
  stats: Stats;
  nowTs: number;
  onSelect?: (s: UserSnapshot) => void;
  /** Ids cujo detalhe (monitor + barra lateral) o perfil atual pode ver. */
  inspectableIds?: Set<string>;
  /** Superadmin: habilita "Encerrar expediente" nos avatares inspecionáveis. */
  canForceLogout?: boolean;
}

function pct(cell: { cx: number; cy: number }) {
  return { x: (cell.cx / WORLD.cols) * 100, y: (cell.cy / WORLD.rows) * 100 };
}

// Posições fixas (em %) das "luzes de teto" — apenas decorativas.
const CEIL_LIGHTS = [
  { x: 22, y: 12 },
  { x: 45, y: 8 },
  { x: 68, y: 14 },
  { x: 85, y: 28 },
  { x: 25, y: 45 },
  { x: 50, y: 50 },
  { x: 75, y: 55 },
];

// Partículas de "poeira" que sobem devagar pelo palco.
const DUST = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 73) % 100,
  top: ((i * 41) % 80) + 10,
  delay: (i % 9) * 1.2,
  size: 1.5 + ((i * 7) % 3),
}));

export function VirtualOffice({
  snapshots,
  stats,
  nowTs,
  onSelect,
  inspectableIds,
  canForceLogout = false,
}: Props) {
  const placed = useMemo(() => placeAvatars(snapshots), [snapshots]);
  const grid = useMemo(() => buildWalkGrid(), []);
  const density = useMemo(() => densityByRoom(snapshots), [snapshots]);
  const maxDensity = useMemo(() => Math.max(1, ...Object.values(density)), [density]);
  const [heatmap, setHeatmap] = useState(false);

  return (
    <div className="space-y-4">
      <ManagerHud snapshots={snapshots} stats={stats} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <button
          type="button"
          onClick={() => setHeatmap((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            heatmap
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Flame className="h-4 w-4" /> Mapa de calor {heatmap ? "ligado" : "desligado"}
        </button>
      </div>

      {/* Palco do escritório — mapa pixel-art top-down (planta atualizada) */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/15 bg-black shadow-2xl">
        <div className="relative w-full" style={{ aspectRatio: `${WORLD.cols} / ${WORLD.rows}` }}>
          {/* Mapa do escritório (background pixel-art) */}
          <img
            src={officeMap}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
            style={{ imageRendering: "pixelated" }}
            loading="lazy"
          />

          {/* Vinheta sutil nas bordas para dar profundidade */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)",
            }}
          />

          {/* Luzes de teto (glow ambiente) */}
          {CEIL_LIGHTS.map((l, i) => (
            <span
              key={i}
              aria-hidden
              className="office-ceil pointer-events-none absolute h-24 w-24 rounded-full blur-2xl"
              style={{
                left: `${l.x}%`,
                top: `${l.y}%`,
                background: "radial-gradient(circle, rgba(255,210,120,0.35), transparent 70%)",
                animationDelay: `${i * 0.6}s`,
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}

          {/* Partículas de poeira */}
          {DUST.map((d, i) => (
            <span
              key={i}
              aria-hidden
              className="office-dust pointer-events-none absolute rounded-full bg-white/40"
              style={{
                left: `${d.left}%`,
                top: `${d.top}%`,
                width: d.size,
                height: d.size,
                animationDelay: `${d.delay}s`,
              }}
            />
          ))}

          {/* Salas (overlay: placa com nome + contagem + heatmap opcional) */}
          {ROOM_ORDER.map((id) => (
            <RoomBox
              key={id}
              room={ROOMS[id]}
              count={density[id as RoomId]}
              heat={heatmap ? density[id as RoomId] / maxDensity : 0}
            />
          ))}

          {/* Decorações da sala de descanso (sinuca, cafeteira, sofá) */}
          <RestRoomDecor />


          {/* Avatares */}
          {placed.map(({ snapshot, cell }) => (
            <AnimatedAvatar
              key={snapshot.profile.id}
              snapshot={snapshot}
              target={cell}
              grid={grid}
              nowTs={nowTs}
              onSelect={onSelect}
              inspectable={inspectableIds ? inspectableIds.has(snapshot.profile.id) : true}
              canForceLogout={canForceLogout}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AnimatedAvatar({
  snapshot,
  target,
  grid,
  nowTs,
  onSelect,
  inspectable,
  canForceLogout,
}: {
  snapshot: UserSnapshot;
  target: Cell;
  grid: WalkGrid;
  nowTs: number;
  onSelect?: (s: UserSnapshot) => void;
  inspectable: boolean;
  canForceLogout: boolean;
}) {
  const { cx, cy, moving } = useAvatarMovement(target, grid);
  const p = pct({ cx, cy });
  return (
    <OfficeAvatar
      snapshot={snapshot}
      xPct={p.x}
      yPct={p.y}
      nowTs={nowTs}
      moving={moving}
      onClick={onSelect}
      inspectable={inspectable}
      canForceLogout={canForceLogout && inspectable}
    />
  );
}

function RoomBox({ room, count, heat }: { room: Room; count: number; heat: number }) {
  const left = (room.x / WORLD.cols) * 100;
  const top = (room.y / WORLD.rows) * 100;
  const width = (room.w / WORLD.cols) * 100;
  const height = (room.h / WORLD.rows) * 100;
  return (
    <div
      className="pointer-events-none absolute rounded-md transition-colors duration-500"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
        background:
          heat > 0
            ? `color-mix(in oklch, var(--color-destructive) ${Math.round(15 + heat * 45)}%, transparent)`
            : "transparent",
        boxShadow:
          heat > 0
            ? `inset 0 0 30px color-mix(in oklch, var(--color-destructive) 40%, transparent)`
            : undefined,
      }}
    >
      {/* Placa com nome da sala + total de pessoas logadas */}
      <div className="absolute left-1/2 top-1 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-foreground/20 bg-background/85 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm whitespace-nowrap">
        <span aria-hidden>{room.emoji}</span>
        <span>{room.label}</span>
        <span
          className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-px text-[9px] font-bold leading-none ${
            count > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {count}
        </span>
      </div>
    </div>
  );
}

function Legend() {
  const items: Array<{ color: string; label: string; dot?: boolean }> = [
    { color: "var(--color-success)", label: "Ativo" },
    { color: "var(--color-warning)", label: "Pausa" },
    { color: "var(--color-info)", label: "Almoço" },
    { color: "var(--color-muted-foreground)", label: "Inativo / Offline" },
    { color: "var(--color-accent)", label: "Reunião" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full ring-2 ring-background"
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Overlay decorativo da sala de Descanso: sinuca, cafeteira, sofá, pufe.
 * Coordenadas em % (relativas ao palco). A sala fica em x=38..48, y=24..33.
 */
function RestRoomDecor() {
  const items: Array<{ x: number; y: number; label: string; icon: string; size: number }> = [
    { x: 40.5, y: 60.5, label: "Sinuca",      icon: "🎱", size: 18 },
    { x: 45.0, y: 58.5, label: "Cafeteira",   icon: "☕", size: 14 },
    { x: 46.5, y: 63.0, label: "Sofá",        icon: "🛋️", size: 16 },
    { x: 41.0, y: 66.5, label: "Pufe",        icon: "🫧", size: 12 },
  ];
  // Converte célula → %: descanso.x=38 → 79.16%, y=24 → 50%, .. usamos posições
  // absolutas já em % para simplicidade.
  return (
    <>
      {items.map((d) => (
        <div
          key={d.label}
          aria-hidden
          title={d.label}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 select-none opacity-80 drop-shadow"
          style={{ left: `${d.x}%`, top: `${d.y}%`, fontSize: d.size }}
        >
          {d.icon}
        </div>
      ))}
    </>
  );
}
