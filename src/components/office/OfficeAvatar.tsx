import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDuration, formatHM, STATUS_COLOR } from "@/lib/format";
import type { UserSnapshot } from "@/lib/operacional-snapshot";
import { isMeeting } from "./office-config";

/** Emoji do "humor" do avatar conforme estado. */
function statusEmoji(s: UserSnapshot): string {
  if (!s.isOnline) return "🌙";
  switch (s.currentStatus) {
    case "ATIVO":
      return isMeeting(s) ? "🗣️" : "🧑‍💻";
    case "INATIVO":
      return "💤";
    case "PAUSA":
      return "☕";
    case "ALMOCO":
      return "🍽️";
    case "ENCERRADO":
      return "👋";
    default:
      return "🙂";
  }
}

function initialsOf(nome: string): string {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/** Produtividade do dia: % do tempo online efetivamente em ATIVO. */
function produtividade(s: UserSnapshot): number {
  if (s.totalOnline <= 0) return 0;
  return Math.round((s.totals.ATIVO / s.totalOnline) * 100);
}

/** Texto curto do "balão" de atividade atual. */
function activityLine(s: UserSnapshot): string | null {
  if (!s.isOnline) return null;
  if (s.currentStatus === "ALMOCO") return `Almoço · ${formatHM(s.currentSince)}`;
  if (s.currentStatus === "PAUSA") return "Em pausa";
  if (s.currentStatus === "INATIVO") return "Inatividade detectada";
  if (isMeeting(s)) return "Em reunião";
  if (s.lastUrl) return s.lastUrl.title;
  if (s.lastDesktopApp) return s.lastDesktopApp.label;
  if (s.lastAppPage) return s.lastAppPage.title;
  return "Trabalhando";
}

interface Props {
  snapshot: UserSnapshot;
  xPct: number;
  yPct: number;
  nowTs: number;
  moving?: boolean;
  onClick?: (s: UserSnapshot) => void;
}

export function OfficeAvatar({ snapshot: s, xPct, yPct, nowTs, moving = false, onClick }: Props) {
  const color = STATUS_COLOR[s.currentStatus] ?? "var(--color-muted-foreground)";
  const sinceMin = s.currentSince ? (nowTs - new Date(s.currentSince).getTime()) / 60000 : 0;
  const lastSeenMin = s.lastSeen ? (nowTs - new Date(s.lastSeen).getTime()) / 60000 : 0;
  const inactive = s.currentStatus === "INATIVO";
  const meeting = s.isOnline && isMeeting(s);
  const line = activityLine(s);

  // Cor do "ponto de alerta" no canto do avatar — segue o spec:
  // 🔴 inatividade · 🟡 almoço longo · 🔵 reunião · 🟣 ócio alto · 🟢 voltou.
  let alertColor: string | null = null;
  if (inactive) alertColor = "var(--color-destructive)";
  else if (s.currentStatus === "ALMOCO" && sinceMin > 60) alertColor = "var(--color-warning)";
  else if (meeting) alertColor = "var(--color-info)";
  else if (s.idleSeconds > 600) alertColor = "var(--color-accent)";
  else if (s.isOnline && s.currentStatus === "ATIVO" && sinceMin < 2)
    alertColor = "var(--color-success)";

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${xPct}%`, top: `${yPct}%`, zIndex: moving ? 20 : 10 }}
    >
      <HoverCard openDelay={80} closeDelay={60}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={() => onClick?.(s)}
            className="group flex w-16 cursor-pointer flex-col items-center gap-0.5 focus:outline-none"
          >
            {/* balão de atividade */}
            {line && (
              <span
                className="pointer-events-none max-w-[100px] truncate rounded-full border bg-popover/95 px-1.5 py-0.5 text-[9px] font-medium text-popover-foreground shadow-md backdrop-blur-sm"
                title={line}
                style={{ borderColor: `color-mix(in oklch, ${color} 45%, transparent)` }}
              >
                {line}
              </span>
            )}
            {/* avatar */}
            <span className="relative grid place-items-center">
              {/* halo pulsante (atrás) */}
              {s.isOnline && (
                <span
                  aria-hidden
                  className={`absolute h-9 w-9 rounded-full ${inactive ? "office-snore" : "office-halo"}`}
                  style={{
                    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
                    color,
                  }}
                />
              )}
              <span
                className={`relative grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white shadow-lg ring-2 ring-card transition-transform group-hover:scale-110 ${
                  s.isOnline ? "" : "opacity-50 grayscale"
                } ${moving ? "office-walking" : ""}`}
                style={{
                  background: `radial-gradient(circle at 30% 25%, color-mix(in oklch, ${color} 30%, white), ${color})`,
                  boxShadow: `0 4px 10px -2px color-mix(in oklch, ${color} 70%, transparent)`,
                }}
              >
                {initialsOf(s.profile.nome)}
              </span>
              {/* sombra no chão */}
              <span
                aria-hidden
                className="absolute -bottom-1.5 h-1.5 w-7 rounded-full bg-foreground/40 blur-[2px]"
              />
              {/* emoji de humor */}
              <span className="absolute -right-1.5 -top-1.5 text-sm drop-shadow-sm">
                {statusEmoji(s)}
              </span>
              {/* ponto de alerta colorido */}
              {alertColor && (
                <span
                  className="office-alert absolute -bottom-1 -left-1 h-2.5 w-2.5 rounded-full ring-2 ring-card"
                  style={{ background: alertColor, color: alertColor }}
                />
              )}
            </span>
            {/* nome */}
            <span className="max-w-[64px] truncate text-[10px] font-medium leading-tight text-foreground/90">
              {s.profile.nome.split(" ")[0]}
            </span>
          </button>
        </HoverCardTrigger>


        <HoverCardContent className="w-72" align="center">
          <div className="flex items-start gap-3">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
              style={{ background: color }}
            >
              {initialsOf(s.profile.nome)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{s.profile.nome}</div>
              <div className="truncate text-xs text-muted-foreground">
                {s.profile.cargo || s.profile.email}
                {s.profile.departamento ? ` · ${s.profile.departamento}` : ""}
              </div>
              <div className="mt-1">
                {s.isOnline ? (
                  <StatusBadge status={s.currentStatus} />
                ) : (
                  <span className="text-xs text-muted-foreground">Offline</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <Info label="Trabalhado hoje" value={formatDuration(s.totals.ATIVO)} />
            <Info label="Produtividade" value={`${produtividade(s)}%`} />
            <Info label="Em pausa" value={formatDuration(s.totals.PAUSA)} />
            <Info label="Almoço" value={formatDuration(s.totals.ALMOCO)} />
            <Info
              label={s.isOnline ? "Neste status há" : "Última atividade"}
              value={
                s.isOnline
                  ? formatDuration(sinceMin)
                  : s.lastSeen
                    ? `há ${formatDuration(lastSeenMin)}`
                    : "—"
              }
            />
            <Info label="Ócio detectado" value={formatDuration(s.idleSeconds / 60)} />
          </div>

          {(s.lastUrl || s.lastDesktopApp || s.lastAppPage) && (
            <div className="mt-3 border-t pt-2 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Tela atual
              </div>
              <div className="truncate font-medium" title={s.lastUrl?.url}>
                {s.lastUrl?.title || s.lastDesktopApp?.label || s.lastAppPage?.title}
              </div>
              {s.lastUrl?.domain && (
                <div className="truncate text-[10px] text-muted-foreground">{s.lastUrl.domain}</div>
              )}
            </div>
          )}
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
