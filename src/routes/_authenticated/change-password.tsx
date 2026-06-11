import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({ meta: [{ title: "Alterar senha" }] }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("A senha deve ter ao menos 8 caracteres.");
    if (password !== confirm) return toast.error("As senhas não conferem.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (user?.id) {
        await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      }
      toast.success("Senha alterada com sucesso.");
      router.navigate({ to: "/" });
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao alterar senha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle>Definir nova senha</CardTitle>
          <p className="text-sm text-muted-foreground">
            Este é seu primeiro acesso. Por segurança, defina uma nova senha pessoal antes de continuar.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pwd">Nova senha</Label>
              <Input id="pwd" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conf">Confirmar senha</Label>
              <Input id="conf" type="password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
