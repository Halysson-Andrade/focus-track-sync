import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isNetworkError, isTimeoutError, withRetry } from "@/lib/async-timeout";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Controle de Atividade" }] }),
  component: AuthPage,
});

type ErrorKind = "timeout" | "network" | "credentials" | "other";

function classifyError(err: unknown): { kind: ErrorKind; message: string } {
  if (isTimeoutError(err)) return { kind: "timeout", message: "Tempo esgotado ao conectar." };
  if (isNetworkError(err))
    return { kind: "network", message: "Falha de rede. Verifique sua conexão." };
  const raw = (err as Error)?.message ?? "";
  if (/invalid login credentials/i.test(raw))
    return { kind: "credentials", message: "E-mail ou senha incorretos." };
  return { kind: "other", message: raw || "Não foi possível entrar. Tente novamente." };
}

function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Modo degradado: timeout/rede persistentes => tela de reconexão com
  // auto-retry, em vez do toast vermelho que parece bug do app.
  const [degraded, setDegraded] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/" });
    });
  }, [router]);

  const clearRetry = () => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  };
  useEffect(() => clearRetry, []);

  const attemptLogin = useCallback(async () => {
    clearRetry();
    setLoading(true);
    try {
      // withRetry só re-tenta timeout/rede (curto prazo). Credenciais inválidas
      // resolvem com { error } (sem throw) => NÃO são re-tentadas aqui.
      const { error } = await withRetry(
        () => supabase.auth.signInWithPassword({ email, password }),
        {
          timeoutMs: 12_000,
          retries: 2,
          message: "Tempo esgotado ao conectar com a autenticação.",
        },
      );
      if (error) throw error;
      setDegraded(false);
      router.navigate({ to: "/" });
    } catch (err) {
      // Loga a causa REAL — antes o erro era engolido e ficava indiagnosticável.
      console.error("[auth] signIn falhou", {
        name: (err as Error)?.name,
        message: (err as Error)?.message,
        err,
      });
      const { kind, message } = classifyError(err);
      if (kind === "timeout" || kind === "network") {
        // Instabilidade persistente: entra em modo degradado e agenda auto-retry
        // com backoff curto + jitter (não martela o backend saturado).
        setDegraded(true);
        retryTimer.current = setTimeout(() => void attemptLogin(), 4_000 + Math.random() * 3_000);
      } else {
        setDegraded(false);
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, router]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void attemptLogin();
  };

  const cancelDegraded = () => {
    clearRetry();
    setDegraded(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Activity className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">Tempo</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Controle inteligente de jornada.</h1>
          <p className="mt-4 max-w-md text-sidebar-foreground/70">
            Monitore atividade, pausas e produtividade do seu time com precisão. Tudo em tempo real.
          </p>
        </div>
        <div className="text-xs text-sidebar-foreground/60">© Tempo · Sistema corporativo</div>
      </div>

      <div className="flex items-center justify-center bg-background p-6">
        {degraded ? (
          <div className="w-full max-w-sm space-y-5 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <div>
              <h2 className="text-xl font-bold">Estamos com instabilidade</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Não foi possível conectar agora. Tentando reconectar automaticamente…
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button onClick={() => void attemptLogin()} disabled={loading}>
                {loading ? "Conectando…" : "Tentar agora"}
              </Button>
              <Button variant="outline" onClick={cancelDegraded} disabled={loading}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="w-full max-w-sm space-y-5">
            <div>
              <h2 className="text-2xl font-bold">Entrar</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use as credenciais fornecidas pelo seu administrador.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : "Entrar"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
