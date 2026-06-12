import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Janela "online": agente reportou-se nos últimos N ms.
// Mais curta que a janela de presença/idle pra refletir status atual em tempo real.
const ONLINE_WINDOW_MS = 120_000; // 2 minutos

/**
 * Estado em tempo (~quase) real da presença das fontes de monitoramento
 * do usuário logado: extensão Chrome e app desktop.
 *
 * - `extOnline`: a extensão envia HEARTBEAT via postMessage enquanto está
 *   ativa em alguma aba. Recebemos um nos últimos 2min => online.
 * - `desktopOnline`: o app desktop escreve em `presenca_desktop.ultimo_ativo`
 *   periodicamente. Linha recente (<2min) => online.
 */
export function usePresenceStatus(userId: string | undefined) {
  const [extOnline, setExtOnline] = useState(false);
  const [desktopOnline, setDesktopOnline] = useState(false);
  const [lastExt, setLastExt] = useState<number>(0);
  const [lastDesktop, setLastDesktop] = useState<number>(0);
  const lastExtRef = useRef(0);

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

  // Desktop: polling em `presenca_desktop`
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from("presenca_desktop")
        .select("ultimo_ativo")
        .eq("usuario_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.ultimo_ativo) {
        setLastDesktop(new Date(data.ultimo_ativo).getTime());
      }
    };
    check();
    const i = window.setInterval(check, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(i);
    };
  }, [userId]);

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

  return { extOnline, desktopOnline };
}
