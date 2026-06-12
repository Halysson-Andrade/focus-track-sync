import { useEffect, useRef, useState } from "react";
import { aStar, type WalkGrid } from "@/components/office/pathfinding";
import type { Cell } from "@/components/office/office-config";

interface MoveState {
  cx: number;
  cy: number;
  /** -1 indo p/ esquerda, 1 p/ direita, 0 parado (para espelhar o avatar). */
  dir: number;
  moving: boolean;
}

/**
 * Anima um avatar da posição atual até `target`, caminhando célula a célula
 * pelo caminho A* sobre `grid`. Recalcula a rota quando o destino muda.
 *
 * @param speed células por segundo (≈ velocidade de caminhada).
 */
export function useAvatarMovement(target: Cell, grid: WalkGrid, speed = 7): MoveState {
  const [state, setState] = useState<MoveState>({
    cx: target.cx,
    cy: target.cy,
    dir: 0,
    moving: false,
  });

  const posRef = useRef<Cell>({ cx: target.cx, cy: target.cy });
  const pathRef = useRef<Cell[]>([]); // waypoints restantes (sem o atual)
  const targetKeyRef = useRef<string>(`${Math.round(target.cx)},${Math.round(target.cy)}`);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  // Recalcula a rota quando o destino muda.
  useEffect(() => {
    const key = `${Math.round(target.cx)},${Math.round(target.cy)}`;
    if (key === targetKeyRef.current && pathRef.current.length === 0) return;
    targetKeyRef.current = key;

    const path = aStar(grid, posRef.current, target);
    // remove o primeiro ponto (posição atual) e garante o destino exato no fim
    const waypoints = path.slice(1);
    if (waypoints.length === 0) {
      waypoints.push({ cx: target.cx, cy: target.cy });
    } else {
      waypoints[waypoints.length - 1] = { cx: target.cx, cy: target.cy };
    }
    pathRef.current = waypoints;

    if (rafRef.current == null) {
      lastTsRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.cx, target.cy, grid]);

  // Loop de animação (rAF). Para sozinho ao chegar.
  function tick(ts: number) {
    if (lastTsRef.current === 0) lastTsRef.current = ts;
    const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000); // clamp p/ abas em background
    lastTsRef.current = ts;

    const wps = pathRef.current;
    if (wps.length === 0) {
      rafRef.current = null;
      setState((s) => ({ ...s, dir: 0, moving: false }));
      return;
    }

    let budget = speed * dt;
    const pos = posRef.current;
    let dir = 0;

    while (budget > 0 && wps.length > 0) {
      const next = wps[0];
      const ddx = next.cx - pos.cx;
      const ddy = next.cy - pos.cy;
      const dist = Math.hypot(ddx, ddy);
      if (dist <= budget) {
        pos.cx = next.cx;
        pos.cy = next.cy;
        budget -= dist;
        wps.shift();
        if (Math.abs(ddx) > 0.001) dir = ddx > 0 ? 1 : -1;
      } else {
        pos.cx += (ddx / dist) * budget;
        pos.cy += (ddy / dist) * budget;
        if (Math.abs(ddx) > 0.001) dir = ddx > 0 ? 1 : -1;
        budget = 0;
      }
    }

    const moving = wps.length > 0;
    setState({ cx: pos.cx, cy: pos.cy, dir, moving });
    if (moving) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return state;
}
