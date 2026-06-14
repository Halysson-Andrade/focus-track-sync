import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, Registro, NavRow, Presenca } from "@/lib/operacional-snapshot";

interface OfficeData {
  profiles: Profile[];
  registros: Registro[];
  navApp: NavRow[];
  navExt: NavRow[];
  navDesk: NavRow[];
  presenca: Presenca[];
  /** Ids de usuários com papel admin (para alocá-los na sala de Liderança). */
  adminIds: Set<string>;
  /** true quando o canal de realtime está conectado (senão, cai no poll). */
  connected: boolean;
  refetch: () => void;
}

const REALTIME_TABLES = [
  "registros_atividade",
  "presenca_desktop",
  "presenca_web",
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
  const [presenca, setPresenca] = useState<Presenca[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  const debounceRef = useRef<number | null>(null);

  const fetchData = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since = startOfDay.toISOString();
    const [r, na, ne, nd, pr, pw] = await Promise.all([
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
      // Heartbeat de presença (uma linha por usuário, upsert). Não filtra por
      // `inicio` — o snapshot decide a janela de validade do último heartbeat.
      supabase.from("presenca_desktop").select("usuario_id, ultimo_ativo"),
      // Heartbeat do app web (mesma forma). Unificado com o desktop abaixo — o
      // snapshot já toma o MAX por usuário, então a presença online reflete
      // qualquer fonte (evita marcar offline quem trabalha só no navegador).
      supabase.from("presenca_web").select("usuario_id, ultimo_ativo"),
    ]);
    setRegistros((r.data ?? []) as Registro[]);
    setNavApp((na.data ?? []) as NavRow[]);
    setNavExt((ne.data ?? []) as NavRow[]);
    setNavDesk((nd.data ?? []) as NavRow[]);
    setPresenca([...((pr.data ?? []) as Presenca[]), ...((pw.data ?? []) as Presenca[])]);
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
      const [profRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("id, nome, email").eq("ativo", true).order("nome"),
        // Admin pode ler todos os papéis (RLS). Falha → set vazio (degrada sem crash).
        supabase.from("user_roles").select("user_id").eq("role", "admin"),
      ]);
      if (cancelled) return;
      setProfiles((profRes.data ?? []) as Profile[]);
      setAdminIds(new Set((rolesRes.data ?? []).map((r) => r.user_id as string)));
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

  return {
    profiles,
    registros,
    navApp,
    navExt,
    navDesk,
    presenca,
    adminIds,
    connected,
    refetch: fetchData,
  };
}
