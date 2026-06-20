import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { withTimeout } from "@/lib/async-timeout";

export interface Profile {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  departamento: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Só o evento SIGNED_OUT é tratado como logout. Uma falha TRANSITÓRIA de
      // refresh (rede/timeout/5xx) NÃO emite SIGNED_OUT — o SDK só o emite quando
      // o refresh token é definitivamente inválido. Assim evitamos derrubar o
      // usuário para /auth por um soluço de rede.
      if (event === "SIGNED_OUT") {
        setUser(null);
        setProfile(null);
        setIsAdmin(false);
        setIsSuperadmin(false);
        setLoading(false);
        return;
      }
      // SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED / INITIAL_SESSION: sincroniza.
      setUser(session?.user ?? null);
      if (!session?.user) setLoading(false);
    });

    withTimeout(supabase.auth.getSession(), 8_000, "Tempo esgotado ao recuperar sessão.")
      .then(({ data }) => {
        setUser(data.session?.user ?? null);
        if (!data.session?.user) setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setProfile(null);
        setIsAdmin(false);
        setIsSuperadmin(false);
        setLoading(false);
      });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: p }, { data: roles }] = await withTimeout(
        Promise.all([
          supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", user.id),
        ]),
        10_000,
        "Tempo esgotado ao carregar perfil.",
      ).catch(() => [{ data: null }, { data: [] }]);
      if (cancelled) return;
      setProfile(p as Profile | null);
      setIsAdmin(!!roles?.some((r) => r.role === "admin" || r.role === "superadmin"));
      setIsSuperadmin(!!roles?.some((r) => r.role === "superadmin"));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { user, profile, isAdmin, isSuperadmin, loading };
}
