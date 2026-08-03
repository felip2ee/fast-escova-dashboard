import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  hint?: string;
  delta?: number;
  invertDelta?: boolean;
  icon: LucideIcon;
  accent?: boolean;
};

export function StatCard({
  label,
  value,
  hint,
  delta,
  invertDelta = false,
  icon: Icon,
  accent = false,
}: Props) {
  const positive = delta === undefined ? true : invertDelta ? delta < 0 : delta > 0;
  const DeltaIcon = (delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="surface-card group relative overflow-hidden p-5 transition-transform duration-300 hover:-translate-y-0.5">
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-px opacity-60",
          accent ? "bg-primary" : "bg-border",
        )}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary transition-colors",
            accent && "border-primary/40 bg-accent text-primary",
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
      {delta !== undefined ? (
        <p
          className={cn(
            "mt-4 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
            positive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          <DeltaIcon className="size-3.5" />
          {Math.abs(delta)}% vs. período anterior
        </p>
      ) : null}
    </div>
  );
}
