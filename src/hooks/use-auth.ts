import { useAuthContext, type AuthState, type Profile } from "@/components/auth-provider";

export type { Profile };

/**
 * Estado de autenticação do app. É apenas um leitor do `AuthProvider` (montado
 * em `__root.tsx`): todos os consumidores compartilham o MESMO subscription e o
 * MESMO fetch de perfil/roles. A assinatura `{ user, profile, isAdmin,
 * isSuperadmin, loading }` é mantida para não exigir mudança nos call sites.
 */
export function useAuth(): AuthState {
  return useAuthContext();
}
