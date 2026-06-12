import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, Registro, NavRow } from "@/lib/operacional-snapshot";

interface OfficeData {
  profiles: Profile[];
  registros: Registro[];
  navApp: NavRow[];
  navExt: NavRow[];
  navDesk: NavRow[];
  /** true quando o canal de realtime está conectado (senão, cai no poll). */
  connected: boolean;
  refetch: () => void;
}

const REALTIME_TABLES = [
  "registros_atividade",
  "presenca_desktop",
  "navegacao_externa",
  "uso_aplicativos",
] as const;

// Poll de segurança: garante atualização mesmo se o realtime cair.
const SAFETY_POLL_MS = 30_000;
const REFETCH_DEBOUNCE_MS = 300;

/**
 * Fonte de dados do painel operacional / escritório virtual.
 * Busca inicial + assinatura Supabase Realtime (postgres_changes) com refetch
 * debounced, e um poll de segurança de 30s como fallback.
 */
export function useOfficeData(enabled: boolean): OfficeData {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [navApp, setNavApp] = useState<NavRow[]>([]);
  const [navExt, setNavExt] = useState<NavRow[]>([]);
  const [navDesk, setNavDesk] = useState<NavRow[]>([]);
  const [connected, setConnected] = useState(false);

  const debounceRef = useRef<number | null>(null);

  const fetchData = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since = startOfDay.toISOString();
    const [r, na, ne, nd] = await Promise.all([
      supabase
        .from("registros_atividade")
        .select("id, usuario_id, status, inicio, fim, duracao_minutos")
        .gte("inicio", since),
      supabase
        .from("navegacao_paginas")
        .select("usuario_id, inicio, fim, duracao_segundos, inativo_segundos, path, title")
        .gte("inicio", since),
      supabase
        .from("navegacao_externa")
        .select("usuario_id, inicio, fim, duracao_segundos, inativo_segundos, url, title, domain")
        .gte("inicio", since),
      supabase
        .from("uso_aplicativos")
        .select(
          "usuario_id, inicio, fim, duracao_segundos, inativo_segundos, process_name, app_label",
        )
        .gte("inicio", since),
    ]);
    setRegistros((r.data ?? []) as Registro[]);
    setNavApp((na.data ?? []) as NavRow[]);
    setNavExt((ne.data ?? []) as NavRow[]);
    setNavDesk((nd.data ?? []) as NavRow[]);
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void fetchData();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchData]);

  // Carrega perfis. cargo/departamento são opcionais (enriquecem o hover-card);
  // ficam disponíveis após aplicar a migration e regenerar os tipos do Supabase.
  // Até lá, selecionamos as colunas conhecidas para manter a query tipada.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const res = await supabase
        .from("profiles")
        .select("id, nome, email")
        .eq("ativo", true)
        .order("nome");
      if (!cancelled) setProfiles((res.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Fetch inicial + realtime + poll de segurança.
  useEffect(() => {
    if (!enabled) return;
    void fetchData();

    const channel = supabase.channel("office-operacional");
    for (const table of REALTIME_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefetch);
    }
    channel.subscribe((status) => {
      setConnected(status === "SUBSCRIBED");
    });

    const poll = window.setInterval(fetchData, SAFETY_POLL_MS);

    return () => {
      window.clearInterval(poll);
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [enabled, fetchData, scheduleRefetch]);

  return { profiles, registros, navApp, navExt, navDesk, connected, refetch: fetchData };
}
