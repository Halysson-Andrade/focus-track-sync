import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/admin": "Usuários",
  "/relatorios": "Relatórios",
  "/ranking": "Ranking",
  "/auth": "Login",
};

const IDLE_THRESHOLD_MS = 60 * 1000; // 1 min of no activity counts as idle

/**
 * Tracks per-page navigation: time spent on each route and idle time within it.
 * Creates a row on route enter, finalizes (sets fim/duracao/inativo) on route change or unload.
 */
export function usePageTracker(userId: string | undefined, registroId: string | null | undefined) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentRowId = useRef<string | null>(null);
  const enteredAt = useRef<number>(Date.now());
  const lastActivity = useRef<number>(Date.now());
  const idleAccum = useRef<number>(0);

  // Track activity to compute idle time
  useEffect(() => {
    const onActivity = () => {
      const now = Date.now();
      const gap = now - lastActivity.current;
      if (gap > IDLE_THRESHOLD_MS) idleAccum.current += gap;
      lastActivity.current = now;
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, []);

  // On path change: close previous row, open new one
  useEffect(() => {
    if (!userId) return;
    if (pathname.startsWith("/auth")) return;

    let cancelled = false;
    const openedAt = Date.now();
    enteredAt.current = openedAt;
    lastActivity.current = openedAt;
    idleAccum.current = 0;

    (async () => {
      const { data } = await supabase
        .from("navegacao_paginas")
        .insert({
          usuario_id: userId,
          registro_id: registroId ?? null,
          path: pathname,
          title: PAGE_LABELS[pathname] ?? pathname,
        })
        .select("id")
        .single();
      if (!cancelled && data) currentRowId.current = data.id;
    })();

    const closeRow = async () => {
      const id = currentRowId.current;
      if (!id) return;
      const now = Date.now();
      // account residual idle if still idle when leaving
      const gap = now - lastActivity.current;
      const idleTotal = idleAccum.current + (gap > IDLE_THRESHOLD_MS ? gap : 0);
      const durSec = (now - enteredAt.current) / 1000;
      currentRowId.current = null;
      await supabase
        .from("navegacao_paginas")
        .update({
          fim: new Date(now).toISOString(),
          duracao_segundos: durSec,
          inativo_segundos: idleTotal / 1000,
        })
        .eq("id", id);
    };

    const onBeforeUnload = () => {
      // best-effort fire-and-forget
      closeRow();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onBeforeUnload);
      closeRow();
    };
  }, [pathname, userId, registroId]);
}
