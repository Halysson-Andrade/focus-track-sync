import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Notificacao = Tables<"notificacoes">;

/** Status derivado dos timestamps, do mais forte (lida) ao mais fraco (pendente). */
export type StatusMensagem = "lida" | "entregue" | "pendente";

export function statusMensagem(n: Notificacao): StatusMensagem {
  if (n.lido_em) return "lida";
  if (n.entregue_em) return "entregue";
  return "pendente";
}

/**
 * Histórico de mensagens ENVIADAS a um destinatário (painel lateral do admin).
 * Busca inicial + realtime (postgres_changes filtrado por destinatário) para o
 * status (pendente/entregue/lida) atualizar ao vivo conforme a extensão entrega.
 */
export function useMensagensEnviadas(uid: string | undefined) {
  const [mensagens, setMensagens] = useState<Notificacao[]>([]);

  const fetchData = useCallback(async () => {
    if (!uid) {
      setMensagens([]);
      return;
    }
    const { data } = await supabase
      .from("notificacoes")
      .select("*")
      .eq("destinatario_id", uid)
      .order("criado_em", { ascending: false })
      .limit(20);
    setMensagens((data ?? []) as Notificacao[]);
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setMensagens([]);
      return;
    }
    void fetchData();
    const channel = supabase
      .channel(`mensagens-enviadas-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notificacoes",
          filter: `destinatario_id=eq.${uid}`,
        },
        () => void fetchData(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, fetchData]);

  return { mensagens, refetch: fetchData };
}

/**
 * Toast global do destinatário: assina INSERT em notificacoes do próprio usuário
 * e mostra a mensagem ao vivo para quem está com o app web aberto. Marca a linha
 * como entregue+lida — assim a extensão (poll) não duplica com a notificação
 * nativa quando o colaborador já está no app. Montado uma única vez no layout
 * autenticado.
 */
export function useNotificacoesRecebidas(uid: string | undefined) {
  // Evita PATCH/toast duplicado caso o realtime reentregue o mesmo evento.
  const vistos = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    vistos.current = new Set();
    const channel = supabase
      .channel(`notificacoes-recebidas-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notificacoes",
          filter: `destinatario_id=eq.${uid}`,
        },
        (payload) => {
          const n = payload.new as Notificacao;
          if (!n?.id || vistos.current.has(n.id)) return;
          vistos.current.add(n.id);
          toast(`Mensagem de ${n.remetente_nome || "Gestor"}`, {
            description: n.conteudo,
            duration: 12_000,
          });
          const nowIso = new Date().toISOString();
          void supabase
            .from("notificacoes")
            .update({ entregue_em: n.entregue_em ?? nowIso, lido_em: nowIso })
            .eq("id", n.id);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid]);
}
