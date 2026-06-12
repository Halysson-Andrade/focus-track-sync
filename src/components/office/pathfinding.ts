// Grid de caminhabilidade do escritório + A* (4-vizinhos) para rotear avatares
// pelos corredores. Paredes = perímetro das salas, exceto as portas (DOORS).
// Salas abertas (OPEN_ROOMS) e o espaço entre salas (corredores) são livres.

import { WORLD, ROOMS, ROOM_ORDER, DOORS, OPEN_ROOMS, type Cell } from "./office-config";

export type WalkGrid = boolean[][]; // [y][x] -> caminhável?

export function buildWalkGrid(): WalkGrid {
  const grid: WalkGrid = Array.from({ length: WORLD.rows }, () =>
    Array.from({ length: WORLD.cols }, () => true),
  );

  for (const id of ROOM_ORDER) {
    if (OPEN_ROOMS.has(id)) continue;
    const room = ROOMS[id];
    const doorSet = new Set(DOORS[id].map((d) => `${d.cx},${d.cy}`));
    const x2 = room.x + room.w - 1;
    const y2 = room.y + room.h - 1;
    for (let y = room.y; y <= y2; y++) {
      for (let x = room.x; x <= x2; x++) {
        const isPerimeter = x === room.x || x === x2 || y === room.y || y === y2;
        if (isPerimeter && !doorSet.has(`${x},${y}`)) {
          if (y >= 0 && y < WORLD.rows && x >= 0 && x < WORLD.cols) grid[y][x] = false;
        }
      }
    }
  }
  return grid;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < WORLD.cols && y >= 0 && y < WORLD.rows;
}

/** Célula caminhável mais próxima (BFS curto) — robustez se start/goal cair em parede. */
function nearestWalkable(grid: WalkGrid, c: Cell): Cell {
  const sx = Math.round(c.cx);
  const sy = Math.round(c.cy);
  if (inBounds(sx, sy) && grid[sy][sx]) return { cx: sx, cy: sy };
  const seen = new Set<string>([`${sx},${sy}`]);
  const queue: Cell[] = [{ cx: sx, cy: sy }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cur.cx + dx;
      const ny = cur.cy + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !inBounds(nx, ny)) continue;
      if (grid[ny][nx]) return { cx: nx, cy: ny };
      seen.add(key);
      queue.push({ cx: nx, cy: ny });
    }
  }
  return { cx: sx, cy: sy };
}

/**
 * A* em grid 4-direções. Retorna a lista de células (inclusive start e goal).
 * Se não houver caminho, retorna [start, goal] (degenera para reta).
 */
export function aStar(grid: WalkGrid, start: Cell, goal: Cell): Cell[] {
  const s = nearestWalkable(grid, start);
  const g = nearestWalkable(grid, goal);
  const key = (x: number, y: number) => `${x},${y}`;
  const startK = key(s.cx, s.cy);
  const goalK = key(g.cx, g.cy);
  if (startK === goalK) return [s];

  const open = new Set<string>([startK]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startK, 0]]);
  const fScore = new Map<string, number>([[startK, heuristic(s, g)]]);

  while (open.size) {
    // nó de menor fScore
    let currentK = "";
    let best = Infinity;
    for (const k of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < best) {
        best = f;
        currentK = k;
      }
    }
    if (currentK === goalK) return reconstruct(cameFrom, currentK);
    open.delete(currentK);
    const [cx, cy] = currentK.split(",").map(Number);

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny) || !grid[ny][nx]) continue;
      const nk = key(nx, ny);
      const tentative = (gScore.get(currentK) ?? Infinity) + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, currentK);
        gScore.set(nk, tentative);
        fScore.set(nk, tentative + heuristic({ cx: nx, cy: ny }, g));
        open.add(nk);
      }
    }
  }
  return [s, g]; // sem caminho: reta
}

function heuristic(a: Cell, b: Cell): number {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

function reconstruct(cameFrom: Map<string, string>, currentK: string): Cell[] {
  const path: Cell[] = [];
  let k: string | undefined = currentK;
  while (k) {
    const [cx, cy] = k.split(",").map(Number);
    path.unshift({ cx, cy });
    k = cameFrom.get(k);
  }
  return path;
}
