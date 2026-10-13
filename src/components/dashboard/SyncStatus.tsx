import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SyncFreshness } from "@/lib/chatwoot-types";

function formattedDate(value: string | null) {
  if (!value) return "ainda não disponível";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Araguaina",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function SyncStatus({ sync }: { sync: SyncFreshness }) {
  const stale = sync.status === "stale";
  const Icon = stale ? AlertTriangle : CheckCircle2;
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
        stale
          ? "border-amber-500/40 bg-amber-500/10 text-amber-800"
          : "border-border bg-secondary/50 text-muted-foreground"
      }`}
      role={stale ? "alert" : "status"}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>Dados atualizados em {formattedDate(sync.lastSuccessAt)}</span>
      {stale && sync.warning ? <strong className="font-semibold">{sync.warning}</strong> : null}
    </div>
  );
}
