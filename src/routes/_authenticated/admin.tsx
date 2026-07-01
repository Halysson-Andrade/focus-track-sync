import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  adminCreateUser,
  adminDeleteUser,
  adminToggleActive,
  adminUpdateUser,
} from "@/lib/admin.functions";
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

type Perfil = "user" | "admin" | "superadmin";

type AdminUser = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  cargo: string | null;
  departamento: string | null;
  espelho_geral: boolean;
  roles: string[];
};

const NONE = "__none__";

function deptLabel(value: string | null) {
  if (!value) return "—";
  return DEPARTAMENTOS.find((d) => d.value === value.toLowerCase())?.label ?? value;
}

function perfilFromRoles(roles: string[]): Perfil {
  if (roles.includes("superadmin")) return "superadmin";
  if (roles.includes("admin")) return "admin";
  return "user";
}

function AdminUsers() {
  const { isAdmin, isSuperadmin, loading, user } = useAuth();
  const router = useRouter();
  const createFn = useServerFn(adminCreateUser);
  const deleteFn = useServerFn(adminDeleteUser);
  const updateFn = useServerFn(adminUpdateUser);
  const toggleActiveFn = useServerFn(adminToggleActive);
  const [list, setList] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    email: "",
    password: "",
    departamento: NONE,
    perfil: "user" as Perfil,
    espelhoGeral: false,
  });
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({
    nome: "",
    cargo: "",
    departamento: NONE,
    perfil: "user" as Perfil,
    espelhoGeral: false,
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
      await createFn({
        data: {
          nome: form.nome,
          email: form.email,
          password: form.password,
          departamento: form.departamento === NONE ? null : form.departamento,
          perfil: form.perfil,
          espelhoGeral: form.espelhoGeral,
        },
      });
      toast.success("Usuário criado");
      setOpen(false);
      setForm({
        nome: "",
        email: "",
        password: "",
        departamento: NONE,
        perfil: "user",
        espelhoGeral: false,
      });
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
      perfil: perfilFromRoles(u.roles),
      espelhoGeral: !!u.espelho_geral,
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
          departamento: editForm.departamento === NONE ? null : editForm.departamento,
          perfil: editForm.perfil,
          // Só superadmin gerencia a flag; para os demais, não envia o campo
          // (o backend também rejeita, esta é a defesa da UI).
          ...(isSuperadmin ? { espelhoGeral: editForm.espelhoGeral } : {}),
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
    try {
      await toggleActiveFn({ data: { userId: id, ativo: !ativo } });
      toast.success(ativo ? "Desativado" : "Ativado");
      load();
    } catch (err) {
      toast.error((err as Error).message ?? "Erro");
    }
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
              <div className="space-y-2">
                <Label>Departamento / Área</Label>
                <Select
                  value={form.departamento}
                  onValueChange={(v) => setForm({ ...form, departamento: v })}
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
              </div>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select
                  value={form.perfil}
                  onValueChange={(v) => setForm({ ...form, perfil: v as Perfil })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuário</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                    {isSuperadmin && <SelectItem value="superadmin">Super Admin</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {isSuperadmin && (
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="pr-3">
                    <Label htmlFor="espelhoGeral">Espelho de Ponto geral</Label>
                    <p className="text-xs text-muted-foreground">
                      Libera ver o espelho de todas as equipes (com HE), mesmo sem ser admin.
                    </p>
                  </div>
                  <Switch
                    id="espelhoGeral"
                    checked={form.espelhoGeral}
                    onCheckedChange={(v) => setForm({ ...form, espelhoGeral: v })}
                  />
                </div>
              )}
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
                    <TableCell className="text-muted-foreground">{u.cargo ?? "—"}</TableCell>
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
                      {(() => {
                        const p = perfilFromRoles(u.roles);
                        if (p === "superadmin")
                          return (
                            <span className="rounded bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                              SUPER ADMIN
                            </span>
                          );
                        if (p === "admin")
                          return (
                            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                              ADMIN
                            </span>
                          );
                        return <span className="text-xs text-muted-foreground">Usuário</span>;
                      })()}
                      {u.espelho_geral && (
                        <span
                          className="ml-1 rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          title="Vê o Espelho de Ponto de todas as equipes"
                        >
                          Espelho geral
                        </span>
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
                  onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })}
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
                  onChange={(e) => setEditForm({ ...editForm, cargo: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Departamento / Área</Label>
                <Select
                  value={editForm.departamento}
                  onValueChange={(v) => setEditForm({ ...editForm, departamento: v })}
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
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select
                  value={editForm.perfil}
                  onValueChange={(v) => setEditForm({ ...editForm, perfil: v as Perfil })}
                  // Trava: não altera o próprio perfil (anti-lockout) nem um
                  // Super Admin quando quem edita não é Super Admin.
                  disabled={
                    editing.id === user?.id ||
                    (editing.roles.includes("superadmin") && !isSuperadmin)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuário</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                    {isSuperadmin && <SelectItem value="superadmin">Super Admin</SelectItem>}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Admins ficam na sala de Liderança.</p>
              </div>
              {isSuperadmin && (
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="pr-3">
                    <Label htmlFor="editEspelhoGeral">Espelho de Ponto geral</Label>
                    <p className="text-xs text-muted-foreground">
                      Libera ver o espelho de todas as equipes (com HE), mesmo sem ser admin.
                    </p>
                  </div>
                  <Switch
                    id="editEspelhoGeral"
                    checked={editForm.espelhoGeral}
                    onCheckedChange={(v) => setEditForm({ ...editForm, espelhoGeral: v })}
                  />
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
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
