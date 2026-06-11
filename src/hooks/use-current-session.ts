import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Status = "ATIVO" | "PAUSA" | "ALMOCO" | "INATIVO" | "ENCERRADO";

export interface Registro {
  id: string;
  usuario_id: string;
  status: Status;
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
  observacao: string | null;
}

const INACTIVITY_LIMIT_MS = 10 * 60 * 1000; // 10 min
// Janela para considerar a extensão "presente": precisa ser maior que o
// limite de inatividade, senão a checagem se desativa justamente quando
// os heartbeats param (almoço / máquina bloqueada).
const EXT_PRESENCE_WINDOW_MS = INACTIVITY_LIMIT_MS + 5 * 60 * 1000;

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch { /* noop */ }
}

export function useCurrentSession(userId: string | undefined) {
  const [current, setCurrent] = useState<Registro | null>(null);
  const [todayRecords, setTodayRecords] = useState<Registro[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const checkRef = useRef<number | null>(null);
  // Quando a extensão envia heartbeats, sabemos o estado real do sistema
  // mesmo com a aba oculta — então não precisamos "perdoar" a ausência.
  const lastExtHeartbeatRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("registros_atividade")
      .select("*")
      .eq("usuario_id", userId)
      .gte("inicio", startOfDay.toISOString())
      .order("inicio", { ascending: true });
    const list = (data ?? []) as Registro[];
    setTodayRecords(list);
    const open = list.find((r) => !r.fim);
    setCurrent(open ?? null);
    if (open?.status === "INATIVO") setShowInactive(true);
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Ask notification permission once
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Activity listeners
  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now(); };
    const onVisibility = () => {
      // Ao voltar à aba: só "perdoa" a ausência se NÃO houver extensão ativa.
      // Com extensão, os heartbeats já cobrem atividade em outras janelas —
      // se eles pararam (almoço, máquina bloqueada), a ausência conta.
      const hasExtension = Date.now() - lastExtHeartbeatRef.current < 3 * 60 * 1000;
      if (!document.hidden && !hasExtension) lastActivityRef.current = Date.now();
    };
    // Heartbeat enviado pela extensão (content script -> postMessage) quando
    // o sistema está ativo ou houve troca de aba em outra janela.
    const onExtMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d && d.source === "monitor-atividade" && d.type === "HEARTBEAT") {
        lastActivityRef.current = Date.now();
        lastExtHeartbeatRef.current = Date.now();
      }
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    window.addEventListener("focus", onVisibility);
    window.addEventListener("message", onExtMessage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("message", onExtMessage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Close current registro and open new one
  const transition = useCallback(async (next: Status, observacao?: string) => {
    if (!userId) return;
    const now = new Date().toISOString();
    if (current) {
      const dur = (new Date(now).getTime() - new Date(current.inicio).getTime()) / 60000;
      await supabase.from("registros_atividade").update({
        fim: now, duracao_minutos: dur,
      }).eq("id", current.id);
    }
    if (next !== "ENCERRADO") {
      const { data, error } = await supabase.from("registros_atividade").insert({
        usuario_id: userId, status: next, inicio: now, observacao: observacao ?? null,
      }).select().single();
      if (error) { toast.error(error.message); return; }
      setCurrent(data as Registro);
    } else {
      setCurrent(null);
    }
    lastActivityRef.current = Date.now();
    await refresh();
  }, [current, userId, refresh]);

  // Inactivity monitor
  useEffect(() => {
    if (!current || current.status !== "ATIVO") {
      if (checkRef.current) window.clearInterval(checkRef.current);
      return;
    }
    checkRef.current = window.setInterval(async () => {
      // Com a extensão ativa (heartbeats recentes em até 3 min), checamos
      // mesmo com a aba oculta — a extensão sabe se o sistema está ocioso.
      // Sem extensão, mantém o comportamento antigo (pausa quando oculto).
      const hasExtension = Date.now() - lastExtHeartbeatRef.current < 3 * 60 * 1000;
      if (document.hidden && !hasExtension) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= INACTIVITY_LIMIT_MS) {
        notify("Inatividade detectada", "Você foi marcado como inativo.");
        await transition("INATIVO", "Inatividade automática");
        setShowInactive(true);
      }
    }, 15000);
    return () => { if (checkRef.current) window.clearInterval(checkRef.current); };
  }, [current, transition]);

  const start = useCallback(async () => {
    await transition("ATIVO");
    notify("Expediente iniciado", "Bom trabalho!");
    toast.success("Expediente iniciado");
  }, [transition]);

  const pause = useCallback(async (observacao: string) => {
    await transition("PAUSA", observacao);
    notify("Pausa iniciada", "Aproveite seu intervalo.");
    toast("Pausa iniciada");
  }, [transition]);

  const lunch = useCallback(async (observacao: string) => {
    await transition("ALMOCO", observacao);
    notify("Almoço iniciado", "Bom apetite!");
    toast("Almoço iniciado");
  }, [transition]);

  const resume = useCallback(async () => {
    await transition("ATIVO");
    setShowInactive(false);
    notify("Bem-vindo de volta", "Você voltou ao trabalho.");
    toast.success("De volta ao trabalho");
  }, [transition]);

  const stop = useCallback(async () => {
    if (!userId) return;
    // If currently paused or at lunch, close that record first, then mark journey end.
    if (current && (current.status === "PAUSA" || current.status === "ALMOCO")) {
      const now = new Date().toISOString();
      const dur = (new Date(now).getTime() - new Date(current.inicio).getTime()) / 60000;
      await supabase.from("registros_atividade").update({
        fim: now, duracao_minutos: dur,
      }).eq("id", current.id);
      // Mark journey end as a zero-length ENCERRADO row.
      await supabase.from("registros_atividade").insert({
        usuario_id: userId, status: "ENCERRADO", inicio: now, fim: now, duracao_minutos: 0,
      });
      setCurrent(null);
      await refresh();
    } else {
      await transition("ENCERRADO");
    }
    notify("Expediente encerrado", "Até logo!");
    toast.success("Expediente encerrado");
  }, [current, userId, transition, refresh]);

  return {
    current, todayRecords, showInactive, setShowInactive,
    start, pause, lunch, resume, stop, refresh,
  };
}
