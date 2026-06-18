import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, Registro, NavRow, Presenca, EventoOcio } from "@/lib/operacional-snapshot";

/**
 * Fonte de dados do escritório virtual com visibilidade por nível.
 *
 * - `base` (office_overview): dados não-sensíveis de TODOS os perfis — alimenta o
 *   mapa, posições, status, online e os cards do topo. Disponível a qualquer perfil.
 * - `detail` (office_detail): navegação/apps/ócio APENAS dos usuários que o
 *   chamador pode inspecionar (superadmin → todos; admin → mesma área; user →
 *   vazio). O recorte por área é feito no backend (RPC SECURITY DEFINER), então
 *   dados de outras áreas nunca chegam ao navegador.
 *
 * Atualização: realtime como gatilho de refetch (admin/superadmin recebem eventos
 * pelo RLS) + poll de segurança adaptativo (cobre o user comum, que não recebe
 * realtime das tabelas alheias).
 */
interface BaseData {
  profiles: Profile[];
  registros: Registro[];
  presenca: Presenca[];
  adminIds: Set<string>;
}

interface DetailData {
  navApp: NavRow[];
  navExt: NavRow[];
  navDesk: NavRow[];
  presencaExt: Presenca[];
  eventos: EventoOcio[];
  inspectableIds: Set<string>;
}

export interface OperacionalData {
  base: BaseData;
  detail: DetailData;
  connected: boolean;
  refetch: () => void;
}

// Realtime APENAS nas tabelas de baixa escrita que mudam o estado do mapa
// (status + presença). As tabelas de alta escrita (navegação/apps/ócio/extensão)
// foram REMOVIDAS do gatilho: elas disparavam refetch constante (enxurrada de
// office_overview/office_detail que entupia o backend). O detalhe dessas fontes
// é atualizado pelo poll periódico, não a cada evento.
const REALTIME_TABLES = ["registros_atividade", "presenca_desktop", "presenca_web"] as const;

const SAFETY_POLL_CONNECTED_MS = 30_000;
const SAFETY_POLL_DISCONNECTED_MS = 20_000;
// Debounce folgado: coalesce rajadas de eventos em um único refetch.
const REFETCH_DEBOUNCE_MS = 1_500;

const EMPTY_DETAIL: DetailData = {
  navApp: [],
  navExt: [],
  navDesk: [],
  presencaExt: [],
  eventos: [],
  inspectableIds: new Set(),
};

function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useOperacionalData(enabled: boolean, isAdmin: boolean): OperacionalData {
  const [base, setBase] = useState<BaseData>({
    profiles: [],
    registros: [],
    presenca: [],
    adminIds: new Set(),
  });
  const [detail, setDetail] = useState<DetailData>(EMPTY_DETAIL);
  const [connected, setConnected] = useState(false);
  const debounceRef = useRef<number | null>(null);
  // Guarda de "em andamento": impede SOBREPOSIÇÃO de fetches. Sem isso, realtime
  // + poll podiam disparar várias chamadas concorrentes de office_overview/detail
  // que ficavam pendentes e entupiam o pool de conexões do backend.
  const inFlightRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    if (inFlightRef.current) return;
    // Não busca com a aba em segundo plano (evita poll/realtime consumir backend
    // e rede sem ninguém olhando).
    if (typeof document !== "undefined" && document.hidden) return;
    inFlightRef.current = true;
    try {
      const since = startOfDayIso();

      const ov = await supabase.rpc("office_overview", { p_since: since });
      if (ov.error) {
        console.error("[operacional] office_overview", ov.error.message);
      } else if (ov.data) {
        const o = ov.data as {
          profiles?: Profile[];
          registros?: Registro[];
          presenca?: Presenca[];
          admin_ids?: string[];
        };
        setBase({
          profiles: o.profiles ?? [],
          registros: o.registros ?? [],
          presenca: o.presenca ?? [],
          adminIds: new Set(o.admin_ids ?? []),
        });
      }

      if (!isAdmin) {
        setDetail(EMPTY_DETAIL);
        return;
      }

      const dt = await supabase.rpc("office_detail", { p_since: since });
      if (dt.error) {
        console.error("[operacional] office_detail", dt.error.message);
      } else if (dt.data) {
        const d = dt.data as {
          inspectable_ids?: string[];
          nav_app?: NavRow[];
          nav_ext?: NavRow[];
          nav_desk?: NavRow[];
          presenca_ext?: {
            usuario_id: string;
            ultimo_visto: string | null;
            ext_version?: string | null;
          }[];
          eventos?: EventoOcio[];
        };
        setDetail({
          navApp: d.nav_app ?? [],
          navExt: d.nav_ext ?? [],
          navDesk: d.nav_desk ?? [],
          // Presença da extensão alimenta apenas o selo de "monitoração ativa"
          // (fonte 'ext' NÃO ancora o online — semântica preservada no snapshot).
          presencaExt: (d.presenca_ext ?? [])
            .filter((x) => x.ultimo_visto)
            .map((x) => ({
              usuario_id: x.usuario_id,
              ultimo_ativo: x.ultimo_visto as string,
              ultimo_visto: x.ultimo_visto,
              versao: x.ext_version ?? null,
              fonte: "ext" as const,
            })),
          eventos: d.eventos ?? [],
          inspectableIds: new Set(d.inspectable_ids ?? []),
        });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, isAdmin]);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void fetchData();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchData]);

  // Fetch inicial + realtime (gatilho de refetch).
  useEffect(() => {
    if (!enabled) return;
    void fetchData();

    const channel = supabase.channel("office-operacional-v2");
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

  // Poll de segurança adaptativo (cobre o user comum, sem realtime das tabelas alheias).
  // fetchData já ignora chamadas com a aba oculta ou com um fetch em andamento.
  useEffect(() => {
    if (!enabled) return;
    const intervalMs = connected ? SAFETY_POLL_CONNECTED_MS : SAFETY_POLL_DISCONNECTED_MS;
    const poll = window.setInterval(fetchData, intervalMs);
    return () => window.clearInterval(poll);
  }, [enabled, connected, fetchData]);

  // Ao voltar a aba para o primeiro plano, faz uma atualização (já que pausamos
  // o fetch enquanto oculta).
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (!document.hidden) void fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, fetchData]);

  return { base, detail, connected, refetch: fetchData };
}
