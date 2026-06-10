import { STATUS_COLOR, STATUS_LABEL } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "var(--color-muted-foreground)";
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground">
      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
