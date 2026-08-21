import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { JUSTIFICATIVA_STATUS_LABEL, type JustificativaOcio } from "@/lib/justificativas-ocio";

/**
 * Fila de justificativas de ociosidade visível ao aprovador. A RLS já entrega só o
 * escopo permitido (superadmin: todas; admin: a própria área). Busca inicial +
 * realtime (postgres_changes) + poll de segurança — mesmo padrão de use-ajustes.
 */
export function useJustificativasOcio(enabled: boolean) {
  const [justificativas, setJustificativas] = useState<JustificativaOcio[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setJustificativas([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("justificativas_ociosidade")
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(500);
    const rows = (data ?? []) as JustificativaOcio[];
    // Pendentes primeiro, depois por data (desc) — a ordem que o aprovador espera.
    rows.sort((a, b) => {
      if (a.status === "pendente" && b.status !== "pendente") return -1;
      if (a.status !== "pendente" && b.status === "pendente") return 1;
      return new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime();
    });
    setJustificativas(rows);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setJustificativas([]);
      setLoading(false);
      return;
    }
    void fetchData();
    const channel = supabase
      .channel("justificativas-ocio-aprovacao")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "justificativas_ociosidade" },
        () => void fetchData(),
      )
      .subscribe();
    const poll = setInterval(() => void fetchData(), 60_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [enabled, fetchData]);

  return { justificativas, loading, refetch: fetchData };
}

/**
 * Toast ao solicitante quando uma justificativa SUA é decidida. Assina UPDATE das
 * próprias linhas. Montado no layout autenticado, junto do toast de ajustes.
 */
export function useDecisaoJustificativaOcioToast(uid: string | undefined) {
  const vistos = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    vistos.current = new Set();
    const channel = supabase
      .channel(`justificativas-ocio-decisao-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "justificativas_ociosidade",
          filter: `usuario_id=eq.${uid}`,
        },
        (payload) => {
          const j = payload.new as JustificativaOcio;
          if (!j?.id || j.status === "pendente") return;
          // A mesma linha pode ser re-decidida (revogação): a chave inclui o status.
          const chave = `${j.id}:${j.status}:${j.decidido_em ?? ""}`;
          if (vistos.current.has(chave)) return;
          vistos.current.add(chave);
          const aprovada = j.status === "aprovada";
          toast[aprovada ? "success" : "error"](
            `Justificativa de ociosidade ${
              JUSTIFICATIVA_STATUS_LABEL[j.status]?.toLowerCase() ?? j.status
            }`,
            {
              description: j.justificativa_decisao
                ? `${j.decidido_por_nome ?? "Gestão"}: ${j.justificativa_decisao}`
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
