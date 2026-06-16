import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, Registro, NavRow, Presenca, EventoOcio } from "@/lib/operacional-snapshot";

interface OfficeData {
  profiles: Profile[];
  registros: Registro[];
  navApp: NavRow[];
  navExt: NavRow[];
  navDesk: NavRow[];
  presenca: Presenca[];
  /** Intervalos de ociosidade (fonte única do ócio reconciliado). */
  eventos: EventoOcio[];
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
  "presenca_extensao",
  "navegacao_externa",
  "navegacao_paginas",
  "uso_aplicativos",
  "eventos_ociosidade",
] as const;

// Poll de segurança (fallback do realtime), adaptativo: enquanto o canal está
// conectado é só um backstop folgado; se o realtime cair, encurtamos o intervalo
// para limitar o atraso até a reconexão.
const SAFETY_POLL_CONNECTED_MS = 30_000;
const SAFETY_POLL_DISCONNECTED_MS = 10_000;
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
  const [eventos, setEventos] = useState<EventoOcio[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  const debounceRef = useRef<number | null>(null);

  const fetchData = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since = startOfDay.toISOString();
    const [r, na, ne, nd, pr, pw, pe, ev] = await Promise.all([
      supabase
        .from("registros_atividade")
        .select("id, usuario_id, status, inicio, fim, duracao_minutos")
        .gte("inicio", since),
      // PostgREST limita a resposta a 1000 linhas por padrão. Estas tabelas de
      // alto volume (uma linha por aba/app) ultrapassam isso com a equipe inteira
      // num dia — sem ordenação, as 1000 retornadas eram as MAIS ANTIGAS, e quem
      // logava mais tarde ficava sem suas linhas recentes ("Aguardando navegação").
      // Ordenar por `inicio` desc + teto folgado garante as linhas RECENTES de cada
      // usuário (que alimentam o "último por usuário"). Correção definitiva
      // (latest-por-usuário no servidor) virá via RPC/view.
      supabase
        .from("navegacao_paginas")
        .select("usuario_id, inicio, fim, duracao_segundos, inativo_segundos, path, title")
        .gte("inicio", since)
        .order("inicio", { ascending: false })
        .limit(2000),
      supabase
        .from("navegacao_externa")
        .select("usuario_id, inicio, fim, duracao_segundos, inativo_segundos, url, title, domain")
        .gte("inicio", since)
        .order("inicio", { ascending: false })
        .limit(2000),
      supabase
        .from("uso_aplicativos")
        .select(
          "usuario_id, inicio, fim, duracao_segundos, inativo_segundos, process_name, app_label",
        )
        .gte("inicio", since)
        .order("inicio", { ascending: false })
        .limit(2000),
      // Heartbeat de presença (uma linha por usuário, upsert). Não filtra por
      // `inicio` — o snapshot decide a janela de validade do último heartbeat.
      // `ultimo_ativo` = atividade real (ancora online); `ultimo_visto` = "app
      // vivo" mesmo ocioso (ancora o selo de monitoração ativa do desktop).
      supabase
        .from("presenca_desktop")
        .select("usuario_id, ultimo_ativo, ultimo_visto, app_version"),
      // Heartbeat do app web (mesma forma). Unificado com o desktop abaixo — o
      // snapshot já toma o MAX por usuário, então a presença online reflete
      // qualquer fonte (evita marcar offline quem trabalha só no navegador).
      supabase.from("presenca_web").select("usuario_id, ultimo_ativo"),
      // Heartbeat "extensão viva" (mesmo ociosa). Sinal dedicado p/ o selo de
      // monitoração da extensão. Tolerante a falha: sem a tabela, cai no fallback
      // (último beat de navegação) sem quebrar o resto da busca.
      supabase.from("presenca_extensao").select("usuario_id, ultimo_visto, ext_version"),
      // Intervalos de ociosidade do dia (fonte ÚNICA do ócio reconciliado).
      // Volume menor que navegação, mas ainda assim ordenamos+limitamos por
      // segurança contra o teto de 1000 linhas do PostgREST.
      supabase
        .from("eventos_ociosidade")
        .select("usuario_id, inicio, fim")
        .gte("inicio", since)
        .order("inicio", { ascending: false })
        .limit(2000),
    ]);
    setRegistros((r.data ?? []) as Registro[]);
    setNavApp((na.data ?? []) as NavRow[]);
    setNavExt((ne.data ?? []) as NavRow[]);
    setNavDesk((nd.data ?? []) as NavRow[]);
    setEventos((ev.data ?? []) as EventoOcio[]);
    // Tagueia a origem p/ o snapshot isolar "desktop ativo", "web" e "extensão".
    // `isOnline` continua ancorado em `ultimo_ativo` de desktop+web (a extensão
    // só alimenta o selo de monitoração, não o online — semântica preservada).
    setPresenca([
      ...((pr.data ?? []) as (Presenca & { app_version?: string | null })[]).map((x) => ({
        ...x,
        versao: x.app_version ?? null,
        fonte: "desktop" as const,
      })),
      ...((pw.data ?? []) as Presenca[]).map((x) => ({ ...x, fonte: "web" as const })),
      ...(
        (pe.data ?? []) as {
          usuario_id: string;
          ultimo_visto: string | null;
          ext_version?: string | null;
        }[]
      )
        .filter((x) => x.ultimo_visto)
        .map((x) => ({
          usuario_id: x.usuario_id,
          ultimo_ativo: x.ultimo_visto as string,
          ultimo_visto: x.ultimo_visto,
          versao: x.ext_version ?? null,
          fonte: "ext" as const,
        })),
    ]);
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
        supabase
          .from("profiles")
          .select("id, nome, email, cargo, departamento")
          .eq("ativo", true)
          .order("nome"),
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

  // Fetch inicial + realtime.
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

    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [enabled, fetchData, scheduleRefetch]);

  // Poll de segurança adaptativo: reage ao estado de conexão do realtime.
  // Conectado → intervalo folgado (só backstop). Desconectado → intervalo curto.
  useEffect(() => {
    if (!enabled) return;
    const intervalMs = connected ? SAFETY_POLL_CONNECTED_MS : SAFETY_POLL_DISCONNECTED_MS;
    const poll = window.setInterval(fetchData, intervalMs);
    return () => window.clearInterval(poll);
  }, [enabled, connected, fetchData]);

  return {
    profiles,
    registros,
    navApp,
    navExt,
    navDesk,
    presenca,
    eventos,
    adminIds,
    connected,
    refetch: fetchData,
  };
}
