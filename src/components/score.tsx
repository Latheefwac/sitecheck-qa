import { cn, scoreColor, scoreFill } from "@/lib/utils";

export function ScoreRing({ value, size = 72, label }: { value: number | null | undefined; size?: number; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"}: ${value ?? "not available"}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreFill(value)} strokeWidth={6} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * v) / 100} />
      </svg>
      <span className={cn("absolute font-semibold tabular-nums", size > 80 ? "text-2xl" : "text-base", scoreColor(value))}>{value ?? "—"}</span>
    </div>
  );
}

export function ScoreBar({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium tabular-nums", scoreColor(value))}>{value ?? "N/A"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, background: scoreFill(value) }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: "pass" | "fail" | "warn" | "brand"; hint?: string }) {
  const t = tone === "pass" ? "text-pass" : tone === "fail" ? "text-fail" : tone === "warn" ? "text-warn" : tone === "brand" ? "text-brand" : "";
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", t)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
