import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isTimeoutError, withTimeout } from "@/lib/async-timeout";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Controle de Atividade" }] }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/" });
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        12_000,
        "Tempo esgotado ao conectar com a autenticação.",
      );
      if (error) throw error;
      router.navigate({ to: "/" });
    } catch (err) {
      toast.error(
        isTimeoutError(err)
          ? "Não foi possível conectar agora. Recarregue a página e tente novamente."
          : ((err as Error).message ?? "Erro"),
      );
    } finally {
      setLoading(false);
    }
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
      </div>
    </div>
  );
}
