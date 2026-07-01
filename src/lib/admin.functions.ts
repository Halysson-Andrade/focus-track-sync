import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const perfilSchema = z.enum(["user", "admin", "superadmin"]);
type Perfil = z.infer<typeof perfilSchema>;

// Sincroniza as linhas de user_roles do alvo com o perfil escolhido.
// Semântica: isAdmin (na UI) = admin OU superadmin; superadmin recebe as duas
// roles (consistente com o seed do guicheweb) para que checagens has_role('admin')
// também passem. Deletes são no-op quando a role não existe.
async function syncRoles(supabaseAdmin: SupabaseClient<Database>, userId: string, perfil: Perfil) {
  if (perfil === "user") {
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "admin");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "superadmin");
  } else if (perfil === "admin") {
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "superadmin");
  } else {
    await supabaseAdmin.from("user_roles").upsert(
      [
        { user_id: userId, role: "admin" },
        { user_id: userId, role: "superadmin" },
      ],
      { onConflict: "user_id,role" },
    );
  }
}

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  nome: z.string().min(1).max(120),
  perfil: perfilSchema.optional(),
  departamento: z.string().max(60).nullable().optional(),
  espelhoGeral: z.boolean().optional(),
});

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!ok) throw new Error("Acesso negado: somente admins podem criar usuários.");

    const perfil: Perfil = data.perfil ?? "user";

    // Privilégio elevado: superadmin e a flag de espelho geral só podem ser
    // concedidos por um superadmin.
    if (perfil === "superadmin" || data.espelhoGeral) {
      const { data: isSuper } = await context.supabase.rpc("is_superadmin", {
        _user_id: context.userId,
      });
      if (!isSuper) {
        throw new Error(
          "Acesso negado: somente super admins podem conceder Super Admin ou o Espelho de Ponto geral.",
        );
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error) throw new Error(error.message);
    const newId = created.user!.id;

    // The trigger already creates profile + 'user' role.
    const perfilUpdate: Database["public"]["Tables"]["profiles"]["Update"] = {};
    if (data.departamento !== undefined) perfilUpdate.departamento = data.departamento ?? null;
    if (data.espelhoGeral !== undefined) perfilUpdate.espelho_geral = !!data.espelhoGeral;
    if (Object.keys(perfilUpdate).length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update(perfilUpdate)
        .eq("id", newId);
      if (upErr) throw new Error(upErr.message);
    }

    await syncRoles(supabaseAdmin, newId, perfil);
    return { id: newId };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!ok) throw new Error("Acesso negado.");
    if (data.userId === context.userId) throw new Error("Você não pode excluir a si mesmo.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  nome: z.string().min(1).max(120),
  cargo: z.string().max(120).nullable().optional(),
  departamento: z.string().max(60).nullable().optional(),
  perfil: perfilSchema,
  espelhoGeral: z.boolean().optional(),
});

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!ok) throw new Error("Acesso negado.");

    const { data: callerIsSuper } = await context.supabase.rpc("is_superadmin", {
      _user_id: context.userId,
    });
    const { data: targetIsSuper } = await context.supabase.rpc("is_superadmin", {
      _user_id: data.userId,
    });

    // Privilégio elevado: só superadmin concede/altera Super Admin, mexe num
    // usuário que já é Super Admin, ou concede a flag de Espelho geral.
    if (!callerIsSuper) {
      if (data.perfil === "superadmin") {
        throw new Error("Acesso negado: somente super admins podem promover a Super Admin.");
      }
      if (targetIsSuper) {
        throw new Error("Acesso negado: somente super admins podem alterar um Super Admin.");
      }
      if (data.espelhoGeral !== undefined) {
        throw new Error(
          "Acesso negado: somente super admins podem conceder o Espelho de Ponto geral.",
        );
      }
    }

    // Anti-lockout: não deixar rebaixar o próprio perfil.
    if (data.userId === context.userId) {
      if (data.perfil === "user") {
        throw new Error("Você não pode remover seu próprio acesso de administrador.");
      }
      if (targetIsSuper && data.perfil !== "superadmin") {
        throw new Error("Você não pode remover seu próprio acesso de Super Admin.");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const perfilUpdate: Database["public"]["Tables"]["profiles"]["Update"] = {
      nome: data.nome,
      cargo: data.cargo ?? null,
      departamento: data.departamento ?? null,
    };
    if (data.espelhoGeral !== undefined) perfilUpdate.espelho_geral = !!data.espelhoGeral;

    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update(perfilUpdate)
      .eq("id", data.userId);
    if (upErr) throw new Error(upErr.message);

    await syncRoles(supabaseAdmin, data.userId, data.perfil);
    return { ok: true };
  });

export const adminToggleActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), ativo: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!ok) throw new Error("Acesso negado.");
    if (data.userId === context.userId && !data.ativo) {
      throw new Error("Você não pode desativar a si mesmo.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ ativo: data.ativo })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
