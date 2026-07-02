import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isNetworkError, isTimeoutError, withTimeout } from "@/lib/async-timeout";

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
  // Modo degradado: mostra tela de reconexão manual (sem auto-retry — o retry
  // automático causava POSTs paralelos porque withTimeout não aborta o fetch
  // subjacente do SDK do Supabase).
  const [degraded, setDegraded] = useState(false);
  // Dedup: garante que só UMA chamada de signInWithPassword esteja em voo, mesmo
  // com re-renders, duplo-clique ou submits repetidos. useState/loading não é
  // suficiente porque o setState é assíncrono e a segunda submissão pode entrar
  // no handler antes do primeiro re-render desabilitar o botão.
  const inflight = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/" });
    });
  }, [router]);

  const attemptLogin = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      // UMA chamada, timeout generoso (25s). Sem retry — o SDK do Supabase não
      // expõe AbortController, então um "timeout" no cliente não cancela o
      // fetch: retentar dispara POSTs paralelos.
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        25_000,
        "Tempo esgotado ao conectar com a autenticação.",
      );
      if (error) throw error;
      setDegraded(false);
      router.navigate({ to: "/" });
    } catch (err) {
      console.error("[auth] signIn falhou", {
        name: (err as Error)?.name,
        message: (err as Error)?.message,
        err,
      });
      const { kind, message } = classifyError(err);
      if (kind === "timeout" || kind === "network") {
        setDegraded(true);
      } else {
        setDegraded(false);
        toast.error(message);
      }
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, [email, password, router]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void attemptLogin();
  };

  const cancelDegraded = () => {
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
