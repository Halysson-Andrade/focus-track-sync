import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOperacionalData } from "@/hooks/use-operacional-data";
import { VirtualOffice } from "@/components/office/VirtualOffice";
import { AvatarDetailSheet } from "@/components/office/AvatarDetailSheet";
import { AvatarMessageSheet } from "@/components/office/AvatarMessageSheet";
import { buildSnapshots, buildStats, type UserSnapshot } from "@/lib/operacional-snapshot";
import { Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/operacional")({
  head: () => ({ meta: [{ title: "Painel Operacional — Escritório Virtual" }] }),
  component: OperacionalPage,
});

function OperacionalPage() {
  const { isAdmin, isSuperadmin, loading } = useAuth();
  const { base, detail, connected } = useOperacionalData(!loading, isAdmin);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<UserSnapshot | null>(null);

  // Ticker de 1s para atualizar contadores/tempos relativos.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Snapshots montados uma vez: base segura (todos) + detalhe por área (só os
  // inspecionáveis trazem navegação → monitor/sheet completo; os demais ficam
  // sem nav e caem na visão "viewer").
  const snapshots: UserSnapshot[] = useMemo(
    () =>
      buildSnapshots(
        base.profiles,
        base.registros,
        detail.navApp,
        detail.navExt,
        detail.navDesk,
        now,
        [...base.presenca, ...detail.presencaExt],
        base.adminIds,
        detail.eventos,
      ),
    [base, detail, now],
  );

  const stats = useMemo(() => buildStats(snapshots), [snapshots]);

  // Mantém o painel lateral sincronizado com os dados em tempo real.
  const selectedLive = useMemo(
    () => (selected ? (snapshots.find((s) => s.profile.id === selected.profile.id) ?? null) : null),
    [selected, snapshots],
  );

  const canInspectSelected = !!selectedLive && detail.inspectableIds.has(selectedLive.profile.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Eye className="h-6 w-6 text-primary" /> Painel Operacional
          </h1>
          <p className="text-sm text-muted-foreground">
            Escritório virtual da equipe em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            {connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-warning"}`}
            />
          </span>
          {connected ? "Ao vivo" : "Sincronizando"} · {new Date(now).toLocaleTimeString("pt-BR")}
        </div>
      </div>

      <VirtualOffice
        snapshots={snapshots}
        stats={stats}
        nowTs={now}
        onSelect={setSelected}
        inspectableIds={detail.inspectableIds}
        canForceLogout={isSuperadmin}
      />

      {/* Avatar inspecionável → painel detalhado; demais → só mensagem.
          IMPORTANTE: os dois sheets ficam SEMPRE montados e só o `selected`
          alterna. Desmontar um Dialog (Radix) ainda aberto deixaria o `<body>`
          com `pointer-events: none` preso — travando os cliques (navegação). */}
      <AvatarDetailSheet
        selected={canInspectSelected ? selectedLive : null}
        registros={base.registros}
        navApp={detail.navApp}
        navExt={detail.navExt}
        navDesk={detail.navDesk}
        nowTs={now}
        onClose={() => setSelected(null)}
      />
      <AvatarMessageSheet
        selected={canInspectSelected ? null : selectedLive}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
