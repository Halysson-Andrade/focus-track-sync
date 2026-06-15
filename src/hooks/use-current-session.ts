import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  INACTIVITY_LIMIT_MS,
  EXT_PRESENCE_WINDOW_MS,
  WEB_PRESENCE_HEARTBEAT_MS,
} from "@/lib/activity-config";

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

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    /* noop */
  }
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
  // Presença do app desktop (heartbeat mediado por banco): mesma ideia da
  // extensão, mas vinda de outro processo. Mantém o usuário ATIVO enquanto
  // trabalha em um app nativo (ex.: VSCode) sem tocar no navegador.
  const lastDesktopHeartbeatRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("registros_atividade")
      .select("*")
      .eq("usuario_id", userId)
      .gte("inicio", startOfDay.toISOString())
      .order("inicio", { ascending: true });
    const list = (data ?? []) as Registro[];
    setTodayRecords(list);
    // Pega o registro ABERTO mais RECENTE (a lista vem em ordem crescente de
    // `inicio`, então `find` pegaria o mais antigo). Robusto contra eventuais
    // registros abertos duplicados — o botão reflete o estado real da jornada.
    const open =
      list
        .filter((r) => !r.fim)
        .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0] ?? null;
    setCurrent(open);
    if (open?.status === "INATIVO") setShowInactive(true);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll de presença do app desktop. Se houve atividade recente em um app
  // nativo, conta como atividade do usuário (evita falso INATIVO) — espelhando
  // o heartbeat da extensão, porém lido do banco (processo separado).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from("presenca_desktop")
        .select("ultimo_ativo")
        .eq("usuario_id", userId)
        .maybeSingle();
      if (cancelled || !data?.ultimo_ativo) return;
      const age = Date.now() - new Date(data.ultimo_ativo).getTime();
      if (age < EXT_PRESENCE_WINDOW_MS) {
        lastActivityRef.current = Date.now();
        lastDesktopHeartbeatRef.current = Date.now();
      }
    };
    check();
    const i = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(i);
    };
  }, [userId]);

  // Heartbeat do próprio app web -> presenca_web. Rede de segurança para que o
  // auto-encerramento server-side não feche por engano um usuário SÓ-web (sem
  // extensão/desktop) que está ativo mas sem navegação interna recente. Só
  // pulsa quando a sessão está ATIVA e houve input REAL recente (< 2x a
  // cadência). NÃO é lido de volta pela detecção de INATIVO (acima lemos apenas
  // presenca_desktop) — evita auto-alimentação que impediria o INATIVO.
  useEffect(() => {
    if (!userId || current?.status !== "ATIVO") return;
    let cancelled = false;
    const beat = async () => {
      if (cancelled) return;
      if (Date.now() - lastActivityRef.current > WEB_PRESENCE_HEARTBEAT_MS * 2) return;
      await supabase
        .from("presenca_web")
        .upsert(
          { usuario_id: userId, ultimo_ativo: new Date().toISOString() },
          { onConflict: "usuario_id" },
        );
    };
    void beat();
    const i = window.setInterval(beat, WEB_PRESENCE_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(i);
    };
  }, [userId, current?.status]);

  // Ask notification permission once
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Activity listeners
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const onVisibility = () => {
      // Ao voltar à aba: só "perdoa" a ausência se NÃO houver extensão ativa.
      // Com extensão, os heartbeats já cobrem atividade em outras janelas —
      // se eles pararam (almoço, máquina bloqueada), a ausência conta.
      const hasPresence =
        (lastExtHeartbeatRef.current > 0 &&
          Date.now() - lastExtHeartbeatRef.current < EXT_PRESENCE_WINDOW_MS) ||
        (lastDesktopHeartbeatRef.current > 0 &&
          Date.now() - lastDesktopHeartbeatRef.current < EXT_PRESENCE_WINDOW_MS);
      if (!document.hidden && !hasPresence) lastActivityRef.current = Date.now();
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
  const transition = useCallback(
    async (next: Status, observacao?: string) => {
      if (!userId) return;
      const now = new Date().toISOString();
      if (current) {
        const dur = (new Date(now).getTime() - new Date(current.inicio).getTime()) / 60000;
        await supabase
          .from("registros_atividade")
          .update({
            fim: now,
            duracao_minutos: dur,
          })
          .eq("id", current.id);
      }
      if (next !== "ENCERRADO") {
        // Abrir sessão é EXCLUSIVO do front, via RPC (SECURITY DEFINER). A RLS
        // recusa INSERT direto de linha aberta — isso bloqueia o auto-início de
        // desktops antigos sem precisar atualizá-los. Ver migration
        // 20260614210000_inicio_expediente_via_rpc.
        const { data, error } = await supabase.rpc("abrir_registro", {
          p_status: next,
          p_observacao: observacao ?? null,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        setCurrent(data as Registro);
      } else {
        setCurrent(null);
      }
      lastActivityRef.current = Date.now();
      await refresh();
    },
    [current, userId, refresh],
  );

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
      const hasPresence =
        (lastExtHeartbeatRef.current > 0 &&
          Date.now() - lastExtHeartbeatRef.current < EXT_PRESENCE_WINDOW_MS) ||
        (lastDesktopHeartbeatRef.current > 0 &&
          Date.now() - lastDesktopHeartbeatRef.current < EXT_PRESENCE_WINDOW_MS);
      if (document.hidden && !hasPresence) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= INACTIVITY_LIMIT_MS) {
        notify("Inatividade detectada", "Você foi marcado como inativo.");
        await transition("INATIVO", "Inatividade automática");
        setShowInactive(true);
      }
    }, 15000);
    return () => {
      if (checkRef.current) window.clearInterval(checkRef.current);
    };
  }, [current, transition]);

  const start = useCallback(async () => {
    await transition("ATIVO");
    notify("Expediente iniciado", "Bom trabalho!");
    toast.success("Expediente iniciado");
  }, [transition]);

  const pause = useCallback(
    async (observacao: string) => {
      await transition("PAUSA", observacao);
      notify("Pausa iniciada", "Aproveite seu intervalo.");
      toast("Pausa iniciada");
    },
    [transition],
  );

  const lunch = useCallback(
    async (observacao: string) => {
      await transition("ALMOCO", observacao);
      notify("Almoço iniciado", "Bom apetite!");
      toast("Almoço iniciado");
    },
    [transition],
  );

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
      await supabase
        .from("registros_atividade")
        .update({
          fim: now,
          duracao_minutos: dur,
        })
        .eq("id", current.id);
      // Mark journey end as a zero-length ENCERRADO row.
      await supabase.from("registros_atividade").insert({
        usuario_id: userId,
        status: "ENCERRADO",
        inicio: now,
        fim: now,
        duracao_minutos: 0,
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
    current,
    todayRecords,
    showInactive,
    setShowInactive,
    start,
    pause,
    lunch,
    resume,
    stop,
    refresh,
  };
}
