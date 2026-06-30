import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const POLL_MS = 20_000;

export interface PresencaDesktop {
  /** epoch ms de `presenca_desktop.ultimo_visto` (0 se ausente). */
  ultimoVisto: number;
  /** epoch ms de `presenca_desktop.ultimo_ativo` (0 se ausente). */
  ultimoAtivo: number;
  /** max(ultimoVisto, ultimoAtivo). */
  ts: number;
}

const EMPTY: PresencaDesktop = { ultimoVisto: 0, ultimoAtivo: 0, ts: 0 };

interface Entry {
  subscribers: Set<(p: PresencaDesktop) => void>;
  timer: ReturnType<typeof setInterval> | null;
  last: PresencaDesktop;
}

// Poller SINGLETON ref-contado por userId. Antes, `presenca_desktop` era
// consultada por DOIS hooks (use-presence-status a cada 15s e
// use-current-session a cada 30s) — duplicação por usuário com aba aberta.
// Agora, N consumidores do MESMO userId compartilham UM único poll; userIds
// diferentes (ex.: admin observando outro usuário) mantêm pollers separados.
const registry = new Map<string, Entry>();

async function poll(userId: string, entry: Entry) {
  const { data } = await supabase
    .from("presenca_desktop")
    .select("ultimo_visto, ultimo_ativo")
    .eq("usuario_id", userId)
    .maybeSingle();
  const ultimoVisto = data?.ultimo_visto ? new Date(data.ultimo_visto).getTime() : 0;
  const ultimoAtivo = data?.ultimo_ativo ? new Date(data.ultimo_ativo).getTime() : 0;
  const next: PresencaDesktop = {
    ultimoVisto,
    ultimoAtivo,
    ts: Math.max(ultimoVisto, ultimoAtivo),
  };
  entry.last = next;
  entry.subscribers.forEach((cb) => cb(next));
}

/**
 * Presença do app desktop (lida de `presenca_desktop`) com poll consolidado.
 * O `setState` retornado pelo `useState` é estável, então serve de subscriber.
 */
export function usePresencaDesktop(userId: string | undefined): PresencaDesktop {
  const [state, setState] = useState<PresencaDesktop>(EMPTY);

  useEffect(() => {
    if (!userId) {
      setState(EMPTY);
      return;
    }
    let entry = registry.get(userId);
    if (!entry) {
      entry = { subscribers: new Set(), timer: null, last: EMPTY };
      registry.set(userId, entry);
    }
    const e = entry;
    e.subscribers.add(setState);
    setState(e.last); // entrega imediata do último valor conhecido
    if (e.timer == null) {
      void poll(userId, e);
      e.timer = setInterval(() => void poll(userId, e), POLL_MS);
    }
    return () => {
      e.subscribers.delete(setState);
      if (e.subscribers.size === 0) {
        if (e.timer != null) clearInterval(e.timer);
        registry.delete(userId);
      }
    };
  }, [userId]);

  return state;
}
