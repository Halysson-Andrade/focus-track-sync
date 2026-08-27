import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePresencaDesktop } from "@/hooks/use-presenca-desktop";
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

// Mensagens amigáveis para os erros do gate de monitoração do backend
// (RPC abrir_registro). O gate exige extensão + app desktop logados para abrir
// o expediente em ATIVO — ver migration de gate_monitoramento.
function friendlyRpcError(message: string | undefined): string {
  const m = (message || "").toLowerCase();
  if (m.includes("extension_offline"))
    return "A extensão do Chrome precisa estar ativa e logada para iniciar/retomar o expediente.";
  if (m.includes("desktop_offline"))
    return "O app desktop precisa estar aberto e logado para iniciar/retomar o expediente.";
  if (m.includes("user not active")) return "Seu usuário está inativo. Procure o administrador.";
  return message || "Não foi possível iniciar o expediente.";
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
    // Reflete o estado REAL: além de abrir o modal ao virar INATIVO, fecha-o
    // quando o status volta a ATIVO/PAUSA/ALMOCO (ex.: o almoço foi iniciado no
    // app desktop, ou o backend recusou a marcação de inatividade).
    setShowInactive(open?.status === "INATIVO");
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sincronismo em tempo real do próprio expediente. Sem isto, o card só
  // atualizava após uma ação local (ou um F5): se o status mudasse no app
  // desktop (ou em outra aba), a tela ficava defasada. `registros_atividade` já
  // está na publicação realtime (REPLICA IDENTITY FULL).
  useEffect(() => {
    if (!userId) return;
    let debounce: number | null = null;
    const scheduleRefresh = () => {
      if (debounce != null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        debounce = null;
        void refresh();
      }, 400);
    };
    const channel = supabase
      .channel(`current-session-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "registros_atividade",
          filter: `usuario_id=eq.${userId}`,
        },
        scheduleRefresh,
      )
      .subscribe();
    return () => {
      if (debounce != null) window.clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // Rede de segurança do sincronismo: se o realtime perder um evento (ou ainda
  // não tiver conectado), o card se atualiza sozinho — sem precisar de F5.
  // Espelha o poll de segurança do painel operacional. Atualiza ao focar/voltar
  // para a aba e num poll leve — que roda TAMBÉM com a aba oculta, em cadência
  // menor (60s): uma aba escondida e defasada era a origem do falso INATIVO
  // durante o almoço (ela seguia achando que o status era ATIVO).
  useEffect(() => {
    if (!userId) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    let ticks = 0;
    const poll = window.setInterval(() => {
      ticks += 1;
      if (document.visibilityState === "visible" || ticks % 3 === 0) void refresh();
    }, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(poll);
    };
  }, [userId, refresh]);

  // Presença do app desktop via poll CONSOLIDADO (compartilhado com
  // use-presence-status). Se houve atividade recente em um app nativo, conta
  // como atividade do usuário (evita falso INATIVO) — espelhando o heartbeat da
  // extensão, porém lido do banco (processo separado).
  const desktop = usePresencaDesktop(userId);
  useEffect(() => {
    if (!desktop.ultimoAtivo) return;
    const age = Date.now() - desktop.ultimoAtivo;
    if (age < EXT_PRESENCE_WINDOW_MS) {
      lastActivityRef.current = Date.now();
      lastDesktopHeartbeatRef.current = Date.now();
    }
  }, [desktop.ultimoAtivo]);

  // Heartbeat do próprio app web -> presenca_web. Marca o usuário logado no
  // navegador como ONLINE mesmo antes de "Iniciar expediente" (fica em Espera
  // no /operacional). Só depende do userId + input REAL recente (< 2x a
  // cadência). Auto-encerramento server-side e detecção local de INATIVO NÃO
  // leem `presenca_web` — não há auto-alimentação.
  useEffect(() => {
    if (!userId) return;
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
  }, [userId]);

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
    async (next: Status, observacao?: string): Promise<boolean> => {
      if (!userId) return false;
      if (next !== "ENCERRADO") {
        // Abrir sessão é EXCLUSIVO do front, via RPC (SECURITY DEFINER). A RLS
        // recusa INSERT direto de linha aberta — isso bloqueia o auto-início de
        // desktops antigos sem precisar atualizá-los. Ver migration
        // 20260614210000_inicio_expediente_via_rpc.
        //
        // A RPC fecha a linha anterior sob advisory lock: NÃO feche aqui antes.
        // Fechar-e-depois-abrir deixava o usuário SEM registro aberto quando a
        // chamada falhava (rede/504/gate) — e o monitor de inatividade, ainda
        // achando que o status era ATIVO, voltava a disparar.
        const { data, error } = await supabase.rpc("abrir_registro", {
          p_status: next,
          p_observacao: observacao ?? undefined,
        });
        if (error) {
          toast.error(friendlyRpcError(error.message));
          return false;
        }
        const row = data as Registro;
        setCurrent(row);
        lastActivityRef.current = Date.now();
        await refresh();
        // A RPC devolve a linha REAL: pedir INATIVO durante pausa/almoço é
        // no-op no backend (migration 20260827120000). Nesse caso a transição
        // não aconteceu — quem chamou não deve tratar como sucesso.
        return row.status === next;
      }
      // Encerramento: marcador de duração zero. O trigger AFTER INSERT
      // fechar_abertos_ao_inserir (20260818143405) fecha a linha aberta no mesmo
      // instante — inclusive uma PAUSA/ALMOCO, cujo fechamento por UPDATE direto
      // passou a ser recusado pelo backend.
      const now = new Date().toISOString();
      const { error } = await supabase.from("registros_atividade").insert({
        usuario_id: userId,
        status: "ENCERRADO",
        inicio: now,
        fim: now,
        duracao_minutos: 0,
        observacao: observacao ?? null,
      });
      if (error) {
        toast.error(error.message);
        return false;
      }
      setCurrent(null);
      lastActivityRef.current = Date.now();
      await refresh();
      return true;
    },
    [userId, refresh],
  );

  // Inactivity monitor. Depende do STATUS/ID (não do objeto `current`, que muda
  // de identidade a cada refresh): senão o interval de 15s era destruído e
  // recriado a cada poll, podendo nunca completar uma checagem.
  const statusAtual = current?.status ?? null;
  const registroAtualId = current?.id ?? null;
  useEffect(() => {
    if (!userId || statusAtual !== "ATIVO") {
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
      if (elapsed < INACTIVITY_LIMIT_MS) return;
      // Confirma o status no BANCO antes de marcar inatividade. Esta aba pode
      // estar defasada — o almoço/pausa pode ter sido iniciado no app desktop ou
      // em outra aba, e marcar INATIVO aqui matava o registro de almoço em curso.
      const { data: aberta } = await supabase
        .from("registros_atividade")
        .select("id, status")
        .eq("usuario_id", userId)
        .is("fim", null)
        .order("inicio", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!aberta || aberta.status !== "ATIVO" || aberta.id !== registroAtualId) {
        await refresh(); // ressincroniza a aba em vez de transicionar
        return;
      }
      if (await transition("INATIVO", "Inatividade automática")) {
        notify("Inatividade detectada", "Você foi marcado como inativo.");
        setShowInactive(true);
      }
    }, 15000);
    return () => {
      if (checkRef.current) window.clearInterval(checkRef.current);
    };
  }, [userId, statusAtual, registroAtualId, transition, refresh]);

  const start = useCallback(async () => {
    if (!(await transition("ATIVO"))) return;
    notify("Expediente iniciado", "Bom trabalho!");
    toast.success("Expediente iniciado");
  }, [transition]);

  const pause = useCallback(
    async (observacao: string) => {
      if (!(await transition("PAUSA", observacao))) return;
      notify("Pausa iniciada", "Aproveite seu intervalo.");
      toast("Pausa iniciada");
    },
    [transition],
  );

  const lunch = useCallback(
    async (observacao: string) => {
      if (!(await transition("ALMOCO", observacao))) return;
      notify("Almoço iniciado", "Bom apetite!");
      toast("Almoço iniciado");
    },
    [transition],
  );

  const resume = useCallback(async () => {
    if (!(await transition("ATIVO"))) return;
    setShowInactive(false);
    notify("Bem-vindo de volta", "Você voltou ao trabalho.");
    toast.success("De volta ao trabalho");
  }, [transition]);

  const stop = useCallback(async () => {
    if (!userId) return;
    // Caminho único: o marcador ENCERRADO fecha a linha aberta pelo trigger do
    // banco, seja ela ATIVO, INATIVO, PAUSA ou ALMOCO.
    if (!(await transition("ENCERRADO"))) return;
    notify("Expediente encerrado", "Até logo!");
    toast.success("Expediente encerrado");
  }, [userId, transition]);

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
