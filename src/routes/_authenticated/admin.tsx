import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { adminCreateUser, adminDeleteUser, adminToggleActive, adminUpdateUser } from "@/lib/admin.functions";
import { DEPARTAMENTOS } from "@/components/office/office-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Usuários" }] }),
  component: AdminUsers,
});

type AdminUser = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  cargo: string | null;
  departamento: string | null;
  roles: string[];
};

const NONE = "__none__";

function deptLabel(value: string | null) {
  if (!value) return "—";
  return DEPARTAMENTOS.find((d) => d.value === value.toLowerCase())?.label ?? value;
}

function AdminUsers() {
  const { isAdmin, loading, user } = useAuth();
  const router = useRouter();
  const createFn = useServerFn(adminCreateUser);
  const deleteFn = useServerFn(adminDeleteUser);
  const updateFn = useServerFn(adminUpdateUser);
  const [list, setList] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    email: "",
    password: "",
    isAdmin: false,
  });
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({
    nome: "",
    cargo: "",
    departamento: NONE,
    isAdmin: false,
  });

  useEffect(() => {
    if (!loading && !isAdmin) router.navigate({ to: "/" });
  }, [loading, isAdmin, router]);

  const load = async () => {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").order("nome"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const rolesByUser = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, []);
      rolesByUser.get(r.user_id)!.push(r.role);
    });
    setList(
      (profiles ?? []).map((p) => ({
        ...p,
        roles: rolesByUser.get(p.id) ?? [],
      })),
    );
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFn({ data: form });
      toast.success("Usuário criado");
      setOpen(false);
      setForm({ nome: "", email: "", password: "", isAdmin: false });
      load();
    } catch (err) {
      toast.error((err as Error).message ?? "Erro");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setEditForm({
      nome: u.nome,
      cargo: u.cargo ?? "",
      departamento: u.departamento?.toLowerCase() ?? NONE,
      isAdmin: u.roles.includes("admin"),
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await updateFn({
        data: {
          userId: editing.id,
          nome: editForm.nome,
          cargo: editForm.cargo.trim() || null,
          departamento:
            editForm.departamento === NONE ? null : editForm.departamento,
          isAdmin: editForm.isAdmin,
        },
      });
      toast.success("Usuário atualizado");
      setEditing(null);
      load();
    } catch (err) {
      toast.error((err as Error).message ?? "Erro");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (id: string, ativo: boolean) => {
    await supabase.from("profiles").update({ ativo: !ativo }).eq("id", id);
    toast.success(ativo ? "Desativado" : "Ativado");
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este usuário permanentemente?")) return;
    try {
      await deleteFn({ data: { userId: id } });
      toast.success("Removido");
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre, edite, ative ou remova usuários do sistema.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cadastrar usuário</DialogTitle>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Senha temporária</Label>
                <Input
                  type="password"
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <Label htmlFor="isAdmin">Administrador</Label>
                <Switch
                  id="isAdmin"
                  checked={form.isAdmin}
                  onCheckedChange={(v) => setForm({ ...form, isAdmin: v })}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={busy}>
                  {busy ? "Criando..." : "Criar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{list.length} usuário(s)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.cargo ?? "—"}
                    </TableCell>
                    <TableCell>
                      {u.departamento ? (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs">
                          {deptLabel(u.departamento)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.roles.includes("admin") ? (
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          ADMIN
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Usuário</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={u.ativo}
                        onCheckedChange={() => toggleActive(u.id, u.ativo)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(u)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(u.id)}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={editForm.nome}
                  onChange={(e) =>
                    setEditForm({ ...editForm, nome: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input value={editing.email} disabled />
              </div>
              <div className="space-y-2">
                <Label>Cargo</Label>
                <Input
                  value={editForm.cargo}
                  placeholder="Ex.: Analista Pleno"
                  onChange={(e) =>
                    setEditForm({ ...editForm, cargo: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Departamento / Área</Label>
                <Select
                  value={editForm.departamento}
                  onValueChange={(v) =>
                    setEditForm({ ...editForm, departamento: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma área" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem departamento</SelectItem>
                    {DEPARTAMENTOS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define em qual sala do mapa o avatar do colaborador aparece.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="editIsAdmin">Administrador</Label>
                  <p className="text-xs text-muted-foreground">
                    Admins ficam na sala de Liderança.
                  </p>
                </div>
                <Switch
                  id="editIsAdmin"
                  checked={editForm.isAdmin}
                  disabled={editing.id === user?.id}
                  onCheckedChange={(v) =>
                    setEditForm({ ...editForm, isAdmin: v })
                  }
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
