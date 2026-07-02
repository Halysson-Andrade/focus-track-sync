import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatDuration, STATUS_LABEL } from "@/lib/format";
import { buildRows, exportCSV, exportExcel, exportPDF } from "@/lib/exports";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type ActivityStatus = Database["public"]["Enums"]["activity_status"];
type RelRow = {
  id: string;
  usuario_id: string;
  status: ActivityStatus;
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
  profiles?: { nome: string | null } | null;
};

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios" }] }),
  beforeLoad: async () => {
    // Porteiro por getSession() (lê do localStorage, sem rede): uma falha/timeout
    // de rede no getUser() devolvia usuário nulo e expulsava um admin logado para
    // /auth. A validação forte contra o servidor já é feita, com folga de 10 min,
    // no gate pai _authenticated/route.tsx.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);
    const isAdmin = !!roles?.some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/" });
  },
  component: Reports,
});

function Reports() {
  const { user, isAdmin } = useAuth();
  const [users, setUsers] = useState<{ id: string; nome: string }[]>([]);
  const [filterUser, setFilterUser] = useState<string>("self");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const today = new Date();
  const ago = new Date();
  ago.setDate(today.getDate() - 7);
  const [from, setFrom] = useState(ago.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [rows, setRows] = useState<RelRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      supabase
        .from("profiles")
        .select("id, nome")
        .order("nome")
        .then(({ data }) => setUsers(data ?? []));
    }
  }, [isAdmin]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const fromIso = new Date(from + "T00:00:00").toISOString();
    const toIso = new Date(to + "T23:59:59").toISOString();
    let q = supabase
      .from("registros_atividade")
      .select("*, profiles(nome)")
      .gte("inicio", fromIso)
      .lte("inicio", toIso)
      .order("inicio", { ascending: false });
    if (filterUser === "self" || !isAdmin) q = q.eq("usuario_id", user.id);
    else if (filterUser !== "all") q = q.eq("usuario_id", filterUser);
    if (filterStatus !== "all") q = q.eq("status", filterStatus as ActivityStatus);
    const { data } = await q;
    setRows((data ?? []) as unknown as RelRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [user, isAdmin]);

  const exportRows = useMemo(
    () =>
      buildRows(
        rows.map((r) => ({
          ...r,
          usuario: r.profiles?.nome ?? "",
        })),
      ),
    [rows],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Filtre e exporte registros de atividade.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          {isAdmin && (
            <div className="space-y-2">
              <Label>Usuário</Label>
              <Select value={filterUser} onValueChange={setFilterUser}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Eu</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={load} className="w-full">
              Aplicar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Resultados ({rows.length})</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => exportCSV(exportRows)}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportExcel(exportRows)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportPDF(exportRows)}>
              <FileText className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Fim</TableHead>
                  <TableHead>Duração</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Nenhum registro.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.profiles?.nome ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDateTime(r.inicio)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.fim ? (
                          formatDateTime(r.fim)
                        ) : (
                          <span className="text-muted-foreground">em andamento</span>
                        )}
                      </TableCell>
                      <TableCell>{formatDuration(r.duracao_minutos ?? 0)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
