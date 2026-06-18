import { useState } from "react";
import { Chrome, Monitor, LogOut } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBadge } from "@/components/StatusBadge";
import { formatAgo, formatDuration, formatHM, STATUS_COLOR } from "@/lib/format";
import type { UserSnapshot } from "@/lib/operacional-snapshot";
import { isMeeting } from "./office-config";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import avatarSprite from "@/assets/office-avatar.png";

/** Hash determinístico → matiz, p/ variar levemente a cor do sprite por pessoa. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

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

/**
 * Rótulo de status para o topo do monitor — apenas para estados que NÃO são
 * navegação ativa (pausa/almoço/inatividade/reunião). Em ATIVO normal retorna
 * null e o monitor mostra só as duas fontes (Extensão + Desktop).
 */
function statusHeader(s: UserSnapshot): string | null {
  if (!s.isOnline) return null;
  if (s.currentStatus === "ALMOCO") return `Almoço · ${formatHM(s.currentSince)}`;
  if (s.currentStatus === "PAUSA") return "Em pausa";
  if (s.currentStatus === "INATIVO") return "Inatividade detectada";
  if (isMeeting(s)) return "Em reunião";
  return null;
}

const ACTIVE_COLOR = "var(--color-success)";
const IDLE_COLOR = "rgba(255,255,255,0.4)";

/** Selo de "monitoração ativa" de um cliente (extensão / desktop). */
function MonitorBadge({
  active,
  icon,
  label,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span
      title={`${label}: ${active ? "monitorando" : "sem sinal"}`}
      className="flex items-center gap-0.5 rounded-full border px-1 py-[1px] leading-none shadow"
      style={{
        background: active
          ? "color-mix(in oklch, var(--color-success) 22%, rgba(8,10,16,0.92))"
          : "rgba(8,10,16,0.88)",
        borderColor: active
          ? "color-mix(in oklch, var(--color-success) 60%, transparent)"
          : "rgba(255,255,255,0.18)",
        color: active ? ACTIVE_COLOR : IDLE_COLOR,
      }}
    >
      {icon}
    </span>
  );
}

/** Linha de fonte dentro do monitor (Extensão ou Desktop) com ponto de liveness. */
function MonitorRow({
  icon,
  active,
  title,
  sub,
  muted,
}: {
  icon: React.ReactNode;
  active: boolean;
  title: string;
  sub?: string | null;
  muted?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="shrink-0" style={{ color: active ? ACTIVE_COLOR : IDLE_COLOR }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${muted ? "italic opacity-50" : "font-semibold"}`}>
          {title}
        </span>
        {sub && <span className="block truncate text-[7px] font-normal opacity-60">{sub}</span>}
      </span>
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: active ? ACTIVE_COLOR : "rgba(255,255,255,0.25)",
          boxShadow: active ? `0 0 5px ${ACTIVE_COLOR}` : "none",
        }}
      />
    </span>
  );
}

interface Props {
  snapshot: UserSnapshot;
  xPct: number;
  yPct: number;
  nowTs: number;
  moving?: boolean;
  onClick?: (s: UserSnapshot) => void;
  /** Pode ver monitor de acesso + hover-card detalhado deste avatar. Quando false,
   *  o hover mostra só o nome (sem monitor/nav) — visão de user / admin fora da área. */
  inspectable?: boolean;
  /** Superadmin: habilita "Encerrar expediente" no hover-card. */
  canForceLogout?: boolean;
}

export function OfficeAvatar({
  snapshot: s,
  xPct,
  yPct,
  nowTs,
  moving = false,
  onClick,
  inspectable = true,
  canForceLogout = false,
}: Props) {
  const color = STATUS_COLOR[s.currentStatus] ?? "var(--color-muted-foreground)";
  const sinceMin = s.currentSince ? (nowTs - new Date(s.currentSince).getTime()) / 60000 : 0;
  const lastSeenMin = s.lastSeen ? (nowTs - new Date(s.lastSeen).getTime()) / 60000 : 0;
  const inactive = s.currentStatus === "INATIVO";
  const meeting = s.isOnline && isMeeting(s);
  const statusLine = statusHeader(s);

  // Rótulo fiel ao estado real quando não há último registro: se o cliente está
  // VIVO (selo verde) mas ainda sem navegação/app, é "aguardando" — não "sem
  // sinal". "Sem sinal" só quando o heartbeat do cliente não chega.
  const extPlaceholder = s.extActive ? "Aguardando navegação" : "Extensão sem sinal";
  const deskPlaceholder = s.desktopActive ? "Aguardando app" : "App sem sinal";

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
            className="group flex w-20 cursor-pointer flex-col items-center gap-0.5 focus:outline-none"
          >
            {/* Monitor expandido: selos de monitoração ativa (desktop/extensão)
                acima + uma linha por fonte com o último registro e liveness.
                Só para avatares inspecionáveis (oculto p/ user e admin fora da área). */}
            {s.isOnline && inspectable && (
              <span className="pointer-events-none relative mb-0.5 flex w-[124px] flex-col items-center">
                {/* selos de "monitoração ativa" por cliente */}
                <span className="mb-0.5 flex items-center gap-1 text-[7px] font-semibold">
                  <MonitorBadge
                    active={s.extActive}
                    label="Extensão"
                    icon={<Chrome className="h-2.5 w-2.5" />}
                  />
                  <MonitorBadge
                    active={s.desktopActive}
                    label="App desktop"
                    icon={<Monitor className="h-2.5 w-2.5" />}
                  />
                </span>
                {/* tela do monitor */}
                <span
                  className="w-full rounded-t-md border border-b-0 px-1 py-0.5 text-[8px] leading-tight text-white shadow-lg"
                  style={{
                    background: `linear-gradient(180deg, rgba(8,10,16,0.95), rgba(20,24,36,0.95))`,
                    borderColor: `color-mix(in oklch, ${color} 55%, transparent)`,
                  }}
                >
                  {statusLine && (
                    <span className="mb-0.5 flex items-center gap-1 border-b border-white/10 pb-0.5">
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                      />
                      <span className="truncate font-semibold">{statusLine}</span>
                    </span>
                  )}
                  <span className="flex flex-col gap-0.5">
                    <MonitorRow
                      icon={<Chrome className="h-2.5 w-2.5" />}
                      active={s.extActive}
                      title={s.lastUrl?.title ?? extPlaceholder}
                      sub={
                        s.lastUrl
                          ? s.lastUrl.live
                            ? s.lastUrl.domain
                            : `${s.lastUrl.domain || "última"} · ${formatAgo(s.lastUrl.ageMs)}`
                          : undefined
                      }
                      muted={!s.lastUrl}
                    />
                    <MonitorRow
                      icon={<Monitor className="h-2.5 w-2.5" />}
                      active={s.desktopActive}
                      title={s.lastDesktopApp?.label ?? deskPlaceholder}
                      sub={
                        s.lastDesktopApp && !s.lastDesktopApp.live
                          ? formatAgo(s.lastDesktopApp.ageMs)
                          : undefined
                      }
                      muted={!s.lastDesktopApp}
                    />
                  </span>
                </span>
                {/* base do monitor */}
                <span
                  className="h-1 w-6 rounded-b-sm"
                  style={{ background: "rgba(15,18,28,0.95)" }}
                />
              </span>
            )}
            {/* avatar pixel-art */}
            <span className="relative grid place-items-center">
              {/* anel de status pulsante (atrás) */}
              {s.isOnline && (
                <span
                  aria-hidden
                  className={`absolute h-11 w-11 rounded-full ${inactive ? "office-snore" : "office-halo"}`}
                  style={{
                    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
                    color,
                  }}
                />
              )}
              {/* sombra elíptica no chão */}
              <span
                aria-hidden
                className="absolute bottom-0 h-1.5 w-8 rounded-full bg-black/55 blur-[2px]"
              />
              {/* base circular = anel colorido do status */}
              <span
                className="relative grid h-10 w-10 place-items-center rounded-full shadow-lg ring-2 transition-transform group-hover:scale-110"
                style={{
                  background: "rgba(20,20,28,0.55)",
                  // @ts-expect-error CSS var inline
                  "--tw-ring-color": color,
                  boxShadow: `0 0 0 2px ${color}, 0 4px 10px -2px rgba(0,0,0,0.5)`,
                }}
              >
                <img
                  src={avatarSprite}
                  alt={s.profile.nome}
                  draggable={false}
                  className={`h-9 w-9 select-none ${s.isOnline ? "" : "opacity-50 grayscale"} ${
                    moving ? "office-walking" : ""
                  }`}
                  style={{
                    imageRendering: "pixelated",
                    filter: `hue-rotate(${hueFor(s.profile.id)}deg) saturate(${s.isOnline ? 1.1 : 0.4})`,
                  }}
                />
              </span>
              {/* emoji de humor */}
              <span className="absolute -right-2 -top-2 text-base drop-shadow-md">
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
            <span
              className="max-w-[72px] truncate rounded px-1 text-[10px] font-semibold leading-tight text-white"
              style={{ background: "rgba(0,0,0,0.55)" }}
            >
              {s.profile.nome.split(" ")[0]}
            </span>
          </button>
        </HoverCardTrigger>

        {/* Hover-card detalhado só para inspecionáveis; do contrário o hover
            mostra apenas o nome (label sempre visível embaixo do avatar). */}
        {inspectable && (
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

            <div className="mt-3 border-t pt-2 text-xs">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Monitoração
              </div>
              <SourceLine
                icon={<Chrome className="h-3 w-3" />}
                name="Extensão"
                version={s.extVersion}
                active={s.extActive}
                title={s.lastUrl?.title}
                sub={s.lastUrl?.domain}
                hint={s.lastUrl?.url}
              />
              <SourceLine
                icon={<Monitor className="h-3 w-3" />}
                name="App desktop"
                version={s.desktopVersion}
                active={s.desktopActive}
                title={s.lastDesktopApp?.label}
              />
            </div>

            {canForceLogout && s.isOnline && <ForceLogoutButton snapshot={s} />}
          </HoverCardContent>
        )}
      </HoverCard>
    </div>
  );
}

/** Botão "Encerrar expediente" (superadmin) com confirmação INLINE (sem Dialog
 *  modal). A confirmação acontece dentro do próprio hover-card para evitar travar
 *  o `<body>` caso o hover feche com um modal aberto. A RPC encerra o registro
 *  aberto do alvo (fica offline) e grava log; o painel atualiza sozinho. */
function ForceLogoutButton({ snapshot: s }: { snapshot: UserSnapshot }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function encerrar() {
    setLoading(true);
    const { error } = await supabase.rpc("encerrar_expediente_admin", {
      p_usuario: s.profile.id,
    });
    setLoading(false);
    setConfirming(false);
    if (error) {
      toast.error(error.message ?? "Falha ao encerrar o expediente");
      return;
    }
    toast.success(`Expediente de ${s.profile.nome.split(" ")[0]} encerrado`);
  }

  const destructive =
    "flex items-center justify-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-60";

  return (
    <div className="mt-3 border-t pt-2">
      {!confirming ? (
        <button
          type="button"
          className={`w-full ${destructive}`}
          onClick={() => setConfirming(true)}
        >
          <LogOut className="h-3.5 w-3.5" /> Encerrar expediente
        </button>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            Encerrar o expediente de {s.profile.nome.split(" ")[0]}? Ficará offline (registrado em
            log).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 ${destructive}`}
              onClick={() => void encerrar()}
              disabled={loading}
            >
              {loading ? "Encerrando…" : "Confirmar"}
            </button>
            <button
              type="button"
              className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
              onClick={() => setConfirming(false)}
              disabled={loading}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
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

/** Linha de fonte (Extensão/Desktop) no hover-card: estado + último registro. */
function SourceLine({
  icon,
  name,
  version,
  active,
  title,
  sub,
  hint,
}: {
  icon: React.ReactNode;
  name: string;
  version?: string | null;
  active: boolean;
  title?: string | null;
  sub?: string | null;
  hint?: string | null;
}) {
  return (
    <div className="mb-1.5 flex items-start gap-2 last:mb-0">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{name}</span>
          {version && <span className="text-[10px] text-muted-foreground/70">v{version}</span>}
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: active ? "var(--color-success)" : "var(--color-muted-foreground)",
              boxShadow: active ? "0 0 5px var(--color-success)" : "none",
            }}
          />
          <span className="text-[10px] text-muted-foreground">
            {active ? "monitorando" : "sem sinal"}
          </span>
        </div>
        <div className="truncate text-muted-foreground" title={hint ?? undefined}>
          {title || (active ? "aguardando registro" : "—")}
        </div>
        {sub && <div className="truncate text-[10px] text-muted-foreground/80">{sub}</div>}
      </div>
    </div>
  );
}
