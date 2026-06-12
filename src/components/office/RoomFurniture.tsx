import type { RoomId } from "./office-config";

/**
 * Mobília decorativa por sala (SVG absolute dentro do retângulo da sala).
 * Puramente visual — não interage com pathfinding nem com avatares.
 */
export function RoomFurniture({ id }: { id: RoomId }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
    >
      {RENDER[id]?.()}
    </svg>
  );
}

const stroke = "color-mix(in oklch, var(--color-foreground) 35%, transparent)";
const fill = "color-mix(in oklch, var(--color-foreground) 8%, transparent)";

function desk(x: number, y: number, w = 14, h = 6) {
  return (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={w} height={h} rx={1} fill={fill} stroke={stroke} strokeWidth={0.4} />
      <circle cx={x + w / 2} cy={y + h + 2.4} r={1.4} fill={stroke} />
    </g>
  );
}

const RENDER: Partial<Record<RoomId, () => React.ReactNode>> = {
  trabalho: () => (
    <>
      {/* fileiras de baias */}
      {[20, 45, 70].map((y) =>
        [10, 28, 46, 64, 82].map((x) => desk(x, y, 14, 6)),
      )}
      {/* corredor central sutil */}
      <line x1="0" y1="40" x2="100" y2="40" stroke={stroke} strokeWidth="0.2" strokeDasharray="2 2" />
      <line x1="0" y1="65" x2="100" y2="65" stroke={stroke} strokeWidth="0.2" strokeDasharray="2 2" />
    </>
  ),
  reuniao: () => (
    <>
      {/* mesa oval */}
      <ellipse cx="50" cy="55" rx="32" ry="14" fill={fill} stroke={stroke} strokeWidth="0.5" />
      {/* cadeiras ao redor */}
      {[
        [20, 55],
        [80, 55],
        [30, 32],
        [50, 28],
        [70, 32],
        [30, 80],
        [50, 84],
        [70, 80],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.2" fill={stroke} />
      ))}
      {/* tela/projetor */}
      <rect x="38" y="8" width="24" height="3" rx="1" fill="var(--color-primary)" opacity="0.5" />
    </>
  ),
  copa: () => (
    <>
      {/* mesas redondas */}
      {[20, 50, 80].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="60" r="8" fill={fill} stroke={stroke} strokeWidth="0.4" />
          <circle cx={cx - 10} cy="60" r="2.2" fill={stroke} />
          <circle cx={cx + 10} cy="60" r="2.2" fill={stroke} />
        </g>
      ))}
      {/* balcão/geladeira */}
      <rect x="6" y="15" width="88" height="10" rx="1.5" fill={fill} stroke={stroke} strokeWidth="0.4" />
      <rect x="10" y="17" width="6" height="6" fill="var(--color-info)" opacity="0.4" />
      <rect x="22" y="17" width="6" height="6" fill="var(--color-warning)" opacity="0.4" />
    </>
  ),
  descanso: () => (
    <>
      {/* sofá em L */}
      <rect x="10" y="40" width="50" height="14" rx="3" fill={fill} stroke={stroke} strokeWidth="0.4" />
      <rect x="10" y="40" width="14" height="42" rx="3" fill={fill} stroke={stroke} strokeWidth="0.4" />
      {/* mesa de centro */}
      <rect x="32" y="60" width="22" height="10" rx="2" fill={fill} stroke={stroke} strokeWidth="0.4" />
      {/* planta */}
      <circle cx="85" cy="50" r="6" fill="var(--color-success)" opacity="0.35" />
      <rect x="83" y="55" width="4" height="6" fill={stroke} />
    </>
  ),
  recepcao: () => (
    <>
      {/* balcão curvo */}
      <path d="M10 60 Q50 35 90 60 L90 72 L10 72 Z" fill={fill} stroke={stroke} strokeWidth="0.5" />
      <text x="50" y="86" textAnchor="middle" fontSize="6" fill={stroke} fontWeight="bold">
        WELCOME
      </text>
    </>
  ),
  lideranca: () => (
    <>
      {/* mesa executiva */}
      <rect x="15" y="35" width="70" height="22" rx="2" fill={fill} stroke={stroke} strokeWidth="0.5" />
      {/* cadeira chefe */}
      <rect x="42" y="62" width="16" height="10" rx="2" fill="var(--color-primary)" opacity="0.4" />
      {/* cadeiras visitas */}
      <rect x="20" y="22" width="12" height="8" rx="1.5" fill={stroke} />
      <rect x="68" y="22" width="12" height="8" rx="1.5" fill={stroke} />
    </>
  ),
  espera: () => (
    <>
      {/* poltronas alinhadas */}
      {[20, 45, 70].map((x) => (
        <rect key={x} x={x} y="55" width="14" height="14" rx="2" fill={fill} stroke={stroke} strokeWidth="0.4" />
      ))}
      <rect x="10" y="20" width="80" height="6" rx="1" fill={fill} stroke={stroke} strokeWidth="0.3" />
    </>
  ),
  externa: () => (
    <>
      {/* jardim/passeio */}
      {[15, 35, 55, 75, 90].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="50" r="6" fill="var(--color-success)" opacity="0.3" />
          <rect x={cx - 0.5} y="55" width="1" height="6" fill={stroke} />
        </g>
      ))}
      <path d="M0 80 L100 80" stroke={stroke} strokeWidth="0.3" strokeDasharray="3 2" />
    </>
  ),
};
