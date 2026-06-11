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

const IDLE_THRESHOLD_MS = 60 * 1000; // 1 min sem atividade conta como inativo

/**
 * Tracks per-page navigation. Conta apenas o tempo em que a aba está
 * efetivamente em foco (visível + janela com foco). Tempo em background
 * (outra aba/janela) NÃO é contabilizado.
 */
export function usePageTracker(userId: string | undefined, registroId: string | null | undefined) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentRowId = useRef<string | null>(null);

  // foco
  const focusedAccum = useRef<number>(0); // ms acumulados em foco
  const focusStart = useRef<number | null>(null); // quando começou o foco atual
  const idleAccum = useRef<number>(0); // ms inativos (sem interação) dentro do foco
  const lastActivity = useRef<number>(Date.now());

  const isFocused = () =>
    typeof document !== "undefined" && !document.hidden && document.hasFocus();

  // Atividade do usuário (para contabilizar inatividade dentro do foco)
  useEffect(() => {
    const onActivity = () => {
      const now = Date.now();
      if (focusStart.current !== null) {
        const gap = now - lastActivity.current;
        if (gap > IDLE_THRESHOLD_MS) idleAccum.current += gap;
      }
      lastActivity.current = now;
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, []);

  // Foco/visibilidade: pausa/retoma contagem
  useEffect(() => {
    const startFocus = () => {
      if (focusStart.current === null) {
        focusStart.current = Date.now();
        lastActivity.current = Date.now();
      }
    };
    const stopFocus = () => {
      if (focusStart.current !== null) {
        const now = Date.now();
        focusedAccum.current += now - focusStart.current;
        const gap = now - lastActivity.current;
        if (gap > IDLE_THRESHOLD_MS) idleAccum.current += gap;
        focusStart.current = null;
      }
    };
    const onVis = () => (isFocused() ? startFocus() : stopFocus());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", startFocus);
    window.addEventListener("blur", stopFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", startFocus);
      window.removeEventListener("blur", stopFocus);
    };
  }, []);

  // Em troca de rota: fecha a anterior e abre nova
  useEffect(() => {
    if (!userId) return;
    if (pathname.startsWith("/auth")) return;

    let cancelled = false;
    // reset acumuladores e inicia foco se a aba estiver visível
    focusedAccum.current = 0;
    idleAccum.current = 0;
    lastActivity.current = Date.now();
    focusStart.current = isFocused() ? Date.now() : null;

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
      let focused = focusedAccum.current;
      if (focusStart.current !== null) focused += now - focusStart.current;
      const gap = now - lastActivity.current;
      const idleTotal =
        idleAccum.current + (focusStart.current !== null && gap > IDLE_THRESHOLD_MS ? gap : 0);
      currentRowId.current = null;
      await supabase
        .from("navegacao_paginas")
        .update({
          fim: new Date(now).toISOString(),
          duracao_segundos: focused / 1000,
          inativo_segundos: Math.min(idleTotal, focused) / 1000,
        })
        .eq("id", id);
    };

    const onBeforeUnload = () => {
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
