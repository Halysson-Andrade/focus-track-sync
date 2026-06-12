import { useMemo, useState } from "react";
import type { UserSnapshot } from "@/lib/operacional-snapshot";
import { useAvatarMovement } from "@/hooks/use-avatar-movement";
import { ManagerHud } from "./ManagerHud";
import { OfficeAvatar } from "./OfficeAvatar";
import { OfficeInsights } from "./OfficeInsights";
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

      <div className="flex items-center justify-end">
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
      <div className="overflow-hidden rounded-xl border bg-muted/20 p-2 shadow-inner">
        <div className="relative w-full" style={{ aspectRatio: `${WORLD.cols} / ${WORLD.rows}` }}>
          {/* piso quadriculado sutil */}
          <div
            className="absolute inset-0 rounded-lg opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--color-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-foreground) 1px, transparent 1px)",
              backgroundSize: `${100 / WORLD.cols}% ${100 / WORLD.rows}%`,
            }}
          />

          {/* salas */}
          {ROOM_ORDER.map((id) => (
            <RoomBox
              key={id}
              room={ROOMS[id]}
              count={density[id as RoomId]}
              heat={heatmap ? density[id as RoomId] / maxDensity : 0}
            />
          ))}

          {/* avatares (cada um caminha até sua sala-destino) */}
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
  // No modo heatmap, a sala "esquenta" (vermelho) conforme a densidade.
  const bg =
    heat > 0
      ? `color-mix(in oklch, var(--color-destructive) ${Math.round(8 + heat * 45)}%, transparent)`
      : `color-mix(in oklch, ${room.tint} 9%, transparent)`;
  return (
    <div
      className="absolute rounded-lg border transition-colors duration-500"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
        background: bg,
        borderColor: `color-mix(in oklch, ${room.tint} 30%, transparent)`,
      }}
    >
      <div className="flex items-center gap-1 px-1.5 pt-1 text-[10px] font-semibold text-foreground/70 sm:text-xs">
        <span>{room.emoji}</span>
        <span className="truncate">{room.label}</span>
        {count > 0 && (
          <span className="ml-auto rounded-full bg-background/70 px-1.5 text-[9px] font-bold text-foreground/70">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}
