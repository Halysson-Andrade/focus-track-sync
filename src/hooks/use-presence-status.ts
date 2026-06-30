import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePresencaDesktop } from "@/hooks/use-presenca-desktop";

// Janela "online": agente reportou-se nos últimos N ms.
// Mais curta que a janela de presença/idle pra refletir status atual em tempo real.
const ONLINE_WINDOW_MS = 120_000; // 2 minutos

/**
 * Estado em tempo (~quase) real da presença das fontes de monitoramento
 * do usuário logado: extensão Chrome e app desktop.
 *
 * - `extOnline`: a extensão envia HEARTBEAT via postMessage enquanto está
 *   ativa em alguma aba. Recebemos um nos últimos 2min => online.
 * - `desktopOnline`: o app desktop novo escreve `presenca_desktop.ultimo_visto`
 *   continuamente enquanto logado (mesmo ocioso). Usamos o mais recente entre
 *   `ultimo_visto` e `ultimo_ativo` (fallback p/ desktop antigo, que só grava
 *   `ultimo_ativo`). Linha recente (<2min) => online.
 */
function desktopTs(data: { ultimo_visto?: string | null; ultimo_ativo?: string | null } | null) {
  if (!data) return 0;
  const v = data.ultimo_visto ? new Date(data.ultimo_visto).getTime() : 0;
  const a = data.ultimo_ativo ? new Date(data.ultimo_ativo).getTime() : 0;
  return Math.max(v, a);
}
export function usePresenceStatus(userId: string | undefined) {
  const [extOnline, setExtOnline] = useState(false);
  const [desktopOnline, setDesktopOnline] = useState(false);
  const [lastExt, setLastExt] = useState<number>(0);
  const [lastDesktop, setLastDesktop] = useState<number>(0);
  const lastExtRef = useRef(0);

  // Desktop: poll CONSOLIDADO de `presenca_desktop` (compartilhado com
  // use-current-session via singleton ref-contado).
  const desktopPresenca = usePresencaDesktop(userId);

  // Extensão: escuta heartbeats via postMessage (mesma origem)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d && d.source === "monitor-atividade" && d.type === "HEARTBEAT") {
        lastExtRef.current = Date.now();
        setLastExt(Date.now());
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Reflete o timestamp do poll consolidado no estado local.
  useEffect(() => {
    if (desktopPresenca.ts) setLastDesktop(desktopPresenca.ts);
  }, [desktopPresenca.ts]);

  // Recalcula online/offline a cada 5s baseado nas janelas
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setExtOnline(lastExt > 0 && now - lastExt < ONLINE_WINDOW_MS);
      setDesktopOnline(lastDesktop > 0 && now - lastDesktop < ONLINE_WINDOW_MS);
    };
    tick();
    const i = window.setInterval(tick, 5_000);
    return () => window.clearInterval(i);
  }, [lastExt, lastDesktop]);

  /**
   * Verificação autoritativa no momento do clique — não confia no estado
   * renderizado (que pode estar desatualizado). Reconsulta o banco para o
   * desktop e usa o último heartbeat REAL da extensão (ref síncrona).
   */
  const checkNow = useCallback(async (): Promise<{ ext: boolean; desktop: boolean }> => {
    const now = Date.now();
    const ext = lastExtRef.current > 0 && now - lastExtRef.current < ONLINE_WINDOW_MS;
    let desktop = false;
    if (userId) {
      const { data } = await supabase
        .from("presenca_desktop")
        .select("ultimo_visto, ultimo_ativo")
        .eq("usuario_id", userId)
        .maybeSingle();
      const ts = desktopTs(data);
      if (ts) {
        desktop = now - ts < ONLINE_WINDOW_MS;
        setLastDesktop(ts);
      }
    }
    setExtOnline(ext);
    setDesktopOnline(desktop);
    return { ext, desktop };
  }, [userId]);

  return { extOnline, desktopOnline, checkNow };
}
