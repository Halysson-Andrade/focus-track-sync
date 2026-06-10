import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Controle de Atividade" }] }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [firstUser, setFirstUser] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if any user exists; if not, allow first signup (becomes admin)
    supabase.from("profiles").select("id", { count: "exact", head: true }).then(({ count }) => {
      const empty = (count ?? 0) === 0;
      setFirstUser(empty);
      if (empty) setMode("signup");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/" });
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { nome }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Conta criada! Você é o administrador.");
        router.navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.navigate({ to: "/" });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Erro");
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
            <h2 className="text-2xl font-bold">{mode === "signup" ? "Criar conta admin" : "Entrar"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {firstUser
                ? "Você será o primeiro usuário — vira administrador automaticamente."
                : mode === "login"
                  ? "Use as credenciais fornecidas pelo seu administrador."
                  : "Cadastre o admin inicial."}
            </p>
          </div>

          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "..." : mode === "signup" ? "Criar conta" : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
