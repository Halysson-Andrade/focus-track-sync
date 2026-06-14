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

export function VirtualOffice({ snapshots, stats, nowTs, onSelect }: Props) {
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

      {/* Palco do escritório — mapa pixel-art top-down */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/15 bg-black shadow-2xl">
        <div
          className="relative w-full"
          style={{ aspectRatio: `${WORLD.cols} / ${WORLD.rows}` }}
        >
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
                background:
                  "radial-gradient(circle, rgba(255,210,120,0.35), transparent 70%)",
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

          {/* Salas (overlay leve: placa + contagem + heatmap opcional) */}
          {ROOM_ORDER.map((id) => (
            <RoomBox
              key={id}
              room={ROOMS[id]}
              count={density[id as RoomId]}
              heat={heatmap ? density[id as RoomId] / maxDensity : 0}
            />
          ))}

          {/* Avatares */}
          {placed.map(({ snapshot, cell }) => (
            <AnimatedAvatar
              key={snapshot.profile.id}
              snapshot={snapshot}
              target={cell}
              grid={grid}
              nowTs={nowTs}
              onSelect={onSelect}
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
}: {
  snapshot: UserSnapshot;
  target: Cell;
  grid: WalkGrid;
  nowTs: number;
  onSelect?: (s: UserSnapshot) => void;
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
      className="pointer-events-none absolute rounded-lg transition-colors duration-500"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
        background:
          heat > 0
            ? `color-mix(in oklch, var(--color-destructive) ${Math.round(15 + heat * 45)}%, transparent)`
            : "transparent",
        border:
          heat > 0
            ? `1px solid color-mix(in oklch, var(--color-destructive) 70%, transparent)`
            : `1px dashed rgba(255,255,255,0.12)`,
        boxShadow:
          heat > 0
            ? `inset 0 0 30px color-mix(in oklch, var(--color-destructive) 40%, transparent)`
            : undefined,
      }}
    >
      {/* placa flutuante da sala */}
      <div
        className="pointer-events-auto m-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold shadow-lg backdrop-blur-md sm:text-xs"
        style={{
          background: "rgba(15,15,20,0.72)",
          color: "white",
          border: `1px solid color-mix(in oklch, ${room.tint} 60%, transparent)`,
        }}
      >
        <span>{room.emoji}</span>
        <span className="truncate">{room.label}</span>
        {count > 0 && (
          <span
            className="ml-1 rounded-full px-1.5 text-[9px] font-bold"
            style={{ background: room.tint, color: "white" }}
          >
            {count}
          </span>
        )}
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
