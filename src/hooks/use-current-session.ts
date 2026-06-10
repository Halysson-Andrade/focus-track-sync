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
    const handler = () => { lastActivityRef.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "focus"];
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    document.addEventListener("visibilitychange", handler);
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      document.removeEventListener("visibilitychange", handler);
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

  const pause = useCallback(async () => {
    await transition("PAUSA");
    notify("Pausa iniciada", "Aproveite seu intervalo.");
    toast("Pausa iniciada");
  }, [transition]);

  const lunch = useCallback(async () => {
    await transition("ALMOCO");
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
    await transition("ENCERRADO");
    notify("Expediente encerrado", "Até logo!");
    toast.success("Expediente encerrado");
  }, [transition]);

  return {
    current, todayRecords, showInactive, setShowInactive,
    start, pause, lunch, resume, stop, refresh,
  };
}
