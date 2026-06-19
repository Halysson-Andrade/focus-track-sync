import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { AJUSTE_STATUS_LABEL } from "@/lib/format";

export type AjusteJornada = Tables<"ajustes_jornada">;

/**
 * Fila de solicitações de ajuste visível ao aprovador. A RLS já entrega só o escopo
 * permitido (superadmin: todas; admin: a própria área). Busca inicial + realtime
 * (postgres_changes) + poll de segurança, no padrão de use-atividades.
 */
export function useAjustesPendentes(enabled: boolean) {
  const [ajustes, setAjustes] = useState<AjusteJornada[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setAjustes([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("ajustes_jornada")
      .select("*")
      .order("status", { ascending: true }) // 'pendente' < 'aprovada' < 'rejeitada' não é garantido; reordenamos abaixo
      .order("criado_em", { ascending: false })
      .limit(500);
    const rows = (data ?? []) as AjusteJornada[];
    // Pendentes primeiro, depois por data (desc).
    rows.sort((a, b) => {
      if (a.status === "pendente" && b.status !== "pendente") return -1;
      if (a.status !== "pendente" && b.status === "pendente") return 1;
      return new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime();
    });
    setAjustes(rows);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setAjustes([]);
      setLoading(false);
      return;
    }
    void fetchData();
    const channel = supabase
      .channel("ajustes-aprovacao")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ajustes_jornada" },
        () => void fetchData(),
      )
      .subscribe();
    // Poll de segurança (caso o realtime caia).
    const poll = setInterval(() => void fetchData(), 60_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [enabled, fetchData]);

  return { ajustes, loading, refetch: fetchData };
}

/**
 * Toast ao solicitante quando uma solicitação SUA é decidida (aprovada/rejeitada).
 * Assina UPDATE em ajustes_jornada do próprio usuário. Montado no layout autenticado.
 */
export function useDecisaoAjusteToast(uid: string | undefined) {
  const vistos = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    vistos.current = new Set();
    const channel = supabase
      .channel(`ajustes-decisao-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ajustes_jornada",
          filter: `usuario_id=eq.${uid}`,
        },
        (payload) => {
          const a = payload.new as AjusteJornada;
          if (!a?.id || a.status === "pendente") return;
          const chave = `${a.id}:${a.status}`;
          if (vistos.current.has(chave)) return;
          vistos.current.add(chave);
          const aprovada = a.status === "aprovada";
          toast[aprovada ? "success" : "error"](
            `Solicitação de ajuste ${AJUSTE_STATUS_LABEL[a.status]?.toLowerCase() ?? a.status}`,
            {
              description: a.justificativa_decisao
                ? `${a.decidido_por_nome ?? "Gestão"}: ${a.justificativa_decisao}`
                : undefined,
              duration: 12_000,
            },
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid]);
}
