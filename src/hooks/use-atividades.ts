import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Atividade {
  id: string;
  usuario_id: string;
  fonte: string;
  external_id: string;
  external_url: string | null;
  titulo: string;
  contexto: string | null;
  total_segundos: number;
  criado_em: string;
  atualizado_em: string;
}

export interface Apontamento {
  id: string;
  atividade_id: string;
  usuario_id: string;
  registro_id: string | null;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
  criado_em: string;
}

export interface AtividadeProfile {
  id: string;
  nome: string | null;
  email: string | null;
}

interface AtividadesData {
  atividades: Atividade[];
  apontamentos: Apontamento[];
  profiles: Map<string, AtividadeProfile>;
  /** true quando o canal de realtime está conectado (senão, cai no poll). */
  connected: boolean;
  refetch: () => void;
}

const REALTIME_TABLES = ["atividades", "atividade_apontamentos"] as const;

const SAFETY_POLL_CONNECTED_MS = 30_000;
const SAFETY_POLL_DISCONNECTED_MS = 10_000;
const REFETCH_DEBOUNCE_MS = 300;
// Janela de apontamentos buscados (o total_segundos já acumula o histórico todo;
// os segmentos detalhados ficam limitados aos recentes para não pesar a query).
const APONTAMENTOS_WINDOW_DAYS = 30;

/**
 * Fonte de dados do board de Atividades. O RLS é a fronteira real do alcance:
 * usuário comum vê só as suas; admin vê as da sua área; superadmin vê todas.
 * Para o usuário comum aplicamos também um filtro explícito por usuario_id
 * (defense-in-depth + evita buscar antes da auth resolver). Mesma mecânica do
 * useOfficeData (busca inicial + realtime postgres_changes com refetch debounced + poll).
 */
export function useAtividades(enabled: boolean, isAdmin: boolean, userId?: string): AtividadesData {
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);
  const [profiles, setProfiles] = useState<Map<string, AtividadeProfile>>(new Map());
  const [connected, setConnected] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Usuário comum: só busca depois que o id resolveu, e filtra pelo próprio id.
  // Admin/superadmin: o RLS decide o alcance (área/tudo), sem filtro no cliente.
  const ready = enabled && (isAdmin || !!userId);

  const fetchData = useCallback(async () => {
    const since = new Date(Date.now() - APONTAMENTOS_WINDOW_DAYS * 86_400_000).toISOString();
    let ativQuery = supabase
      .from("atividades")
      .select(
        "id, usuario_id, fonte, external_id, external_url, titulo, contexto, total_segundos, criado_em, atualizado_em",
      )
      .order("atualizado_em", { ascending: false });
    // Recentes OU em andamento (para o cronômetro ao vivo do board).
    let apontQuery = supabase
      .from("atividade_apontamentos")
      .select("id, atividade_id, usuario_id, registro_id, inicio, fim, duracao_segundos, criado_em")
      .or(`fim.is.null,inicio.gte.${since}`)
      .order("inicio", { ascending: false });

    if (!isAdmin && userId) {
      ativQuery = ativQuery.eq("usuario_id", userId);
      apontQuery = apontQuery.eq("usuario_id", userId);
    }

    const [ativ, apont] = await Promise.all([ativQuery, apontQuery]);
    setAtividades((ativ.data ?? []) as Atividade[]);
    setApontamentos((apont.data ?? []) as Apontamento[]);
  }, [isAdmin, userId]);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void fetchData();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchData]);

  // Perfis: só o admin precisa do mapa de nomes (board da equipe). Para usuário
  // comum o board mostra só as próprias atividades, sem coluna de pessoa.
  useEffect(() => {
    if (!ready || !isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, nome, email");
      if (cancelled) return;
      const map = new Map<string, AtividadeProfile>();
      for (const p of (data ?? []) as AtividadeProfile[]) map.set(p.id, p);
      setProfiles(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, isAdmin]);

  useEffect(() => {
    if (!ready) return;
    void fetchData();

    const channel = supabase.channel("board-atividades");
    for (const table of REALTIME_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefetch);
    }
    channel.subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [ready, fetchData, scheduleRefetch]);

  useEffect(() => {
    if (!ready) return;
    const intervalMs = connected ? SAFETY_POLL_CONNECTED_MS : SAFETY_POLL_DISCONNECTED_MS;
    const poll = window.setInterval(fetchData, intervalMs);
    return () => window.clearInterval(poll);
  }, [ready, connected, fetchData]);

  return { atividades, apontamentos, profiles, connected, refetch: fetchData };
}
