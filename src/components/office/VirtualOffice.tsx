import { useMemo, useState } from "react";
import type { UserSnapshot } from "@/lib/operacional-snapshot";
import { useAvatarMovement } from "@/hooks/use-avatar-movement";
import { ManagerHud } from "./ManagerHud";
import { OfficeAvatar } from "./OfficeAvatar";
import { OfficeInsights } from "./OfficeInsights";
import { RoomFurniture } from "./RoomFurniture";
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
import type { Insight } from "./insights";
import { Flame } from "lucide-react";

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
  insights?: Insight[];
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

export function VirtualOffice({ snapshots, stats, nowTs, insights, onSelect }: Props) {
  const placed = useMemo(() => placeAvatars(snapshots), [snapshots]);
  const grid = useMemo(() => buildWalkGrid(), []);
  const density = useMemo(() => densityByRoom(snapshots), [snapshots]);
  const maxDensity = useMemo(() => Math.max(1, ...Object.values(density)), [density]);
  const [heatmap, setHeatmap] = useState(false);

  return (
    <div className="space-y-4">
      <ManagerHud snapshots={snapshots} stats={stats} />

      {insights && <OfficeInsights insights={insights} />}

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

      {/* Palco do escritório */}
      <div
        className="relative overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          background:
            "radial-gradient(ellipse at 30% 0%, color-mix(in oklch, var(--color-primary) 10%, transparent), transparent 55%), radial-gradient(ellipse at 90% 100%, color-mix(in oklch, var(--color-accent) 9%, transparent), transparent 55%), linear-gradient(180deg, color-mix(in oklch, var(--color-muted) 60%, var(--color-background)) 0%, var(--color-background) 100%)",
        }}
      >
        {/* Skylight superior */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-20 opacity-60"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklch, var(--color-primary) 18%, transparent), transparent)",
          }}
        />
        <div
          className="relative w-full p-3 sm:p-5"
          style={{ aspectRatio: `${WORLD.cols} / ${WORLD.rows}` }}
        >
          {/* Piso: tabuleiro com leve perspectiva e brilho central */}
          <div
            aria-hidden
            className="absolute inset-3 sm:inset-5 rounded-xl"
            style={{
              background:
                "radial-gradient(ellipse at 50% 60%, color-mix(in oklch, var(--color-primary) 6%, transparent), transparent 70%), color-mix(in oklch, var(--color-card) 80%, transparent)",
              boxShadow:
                "inset 0 1px 0 color-mix(in oklch, var(--color-foreground) 8%, transparent), inset 0 -40px 80px color-mix(in oklch, var(--color-foreground) 12%, transparent)",
            }}
          />
          {/* Grid sutil do chão */}
          <div
            aria-hidden
            className="absolute inset-3 sm:inset-5 rounded-xl opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--color-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-foreground) 1px, transparent 1px)",
              backgroundSize: `${100 / WORLD.cols}% ${100 / WORLD.rows}%`,
            }}
          />

          {/* Luzes de teto */}
          {CEIL_LIGHTS.map((l, i) => (
            <span
              key={i}
              aria-hidden
              className="office-ceil pointer-events-none absolute h-24 w-24 rounded-full blur-2xl"
              style={{
                left: `${l.x}%`,
                top: `${l.y}%`,
                background:
                  "radial-gradient(circle, color-mix(in oklch, var(--color-warning) 35%, transparent), transparent 70%)",
                animationDelay: `${i * 0.6}s`,
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}

          {/* Partículas */}
          {DUST.map((d, i) => (
            <span
              key={i}
              aria-hidden
              className="office-dust pointer-events-none absolute rounded-full bg-foreground/40"
              style={{
                left: `${d.left}%`,
                top: `${d.top}%`,
                width: d.size,
                height: d.size,
                animationDelay: `${d.delay}s`,
              }}
            />
          ))}

          {/* Salas (com mobília decorativa) */}
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
  const bg =
    heat > 0
      ? `color-mix(in oklch, var(--color-destructive) ${Math.round(10 + heat * 50)}%, transparent)`
      : `color-mix(in oklch, ${room.tint} 12%, transparent)`;
  const borderColor =
    heat > 0
      ? `color-mix(in oklch, var(--color-destructive) ${Math.round(40 + heat * 40)}%, transparent)`
      : `color-mix(in oklch, ${room.tint} 45%, transparent)`;
  return (
    <div
      className="absolute overflow-hidden rounded-xl border-2 backdrop-blur-[1px] transition-colors duration-500"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
        background: bg,
        borderColor,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${room.tint} 20%, transparent), 0 6px 18px -10px color-mix(in oklch, ${room.tint} 60%, transparent)`,
      }}
    >
      {/* mobília decorativa */}
      <RoomFurniture id={room.id} />

      {/* placa da sala */}
      <div
        className="relative z-10 m-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur sm:text-xs"
        style={{
          background: `color-mix(in oklch, var(--color-background) 70%, ${room.tint})`,
          color: `color-mix(in oklch, var(--color-foreground) 85%, ${room.tint})`,
        }}
      >
        <span>{room.emoji}</span>
        <span className="truncate">{room.label}</span>
        {count > 0 && (
          <span
            className="ml-1 rounded-full px-1.5 text-[9px] font-bold"
            style={{
              background: room.tint,
              color: "var(--color-background)",
            }}
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
