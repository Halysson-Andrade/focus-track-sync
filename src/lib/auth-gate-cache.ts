// Cache em memória do gate de autenticação (_authenticated/route.tsx).
//
// Guarda apenas o resultado NEGATIVO de `must_change_password` (usuário já
// trocou a senha), para o beforeLoad pular essa query nas próximas navegações.
// O caso `true` nunca é cacheado (sempre reavalia até a troca). É limpo
// explicitamente ao concluir a troca de senha (change-password).
const passwordOkCache = new Set<string>();

export function isPasswordOk(userId: string): boolean {
  return passwordOkCache.has(userId);
}

export function markPasswordOk(userId: string): void {
  passwordOkCache.add(userId);
}

export function clearMustChangeCache(userId?: string): void {
  if (userId) passwordOkCache.delete(userId);
  else passwordOkCache.clear();
}
