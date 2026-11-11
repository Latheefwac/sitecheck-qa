"use client";
/* eslint-disable @next/next/no-img-element -- screenshots are private API files; next/image optimisation adds nothing here */
import { useMemo, useState } from "react";
import { NativeSelect } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { VIEWPORTS, type ScreenshotRecord } from "@/lib/types";
import { fileUrl } from "@/lib/utils";

export function Screenshots({ shots }: { shots: ScreenshotRecord[] }) {
  const pages = useMemo(() => [...new Set(shots.map((s) => s.pageUrl))], [shots]);
  const [page, setPage] = useState(pages[0] ?? "");
  const [showDiff, setShowDiff] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  if (!shots.length) return <p className="py-8 text-center text-sm text-muted-foreground">No screenshots captured yet.</p>;
  const order = (v: string) => { const i = VIEWPORTS.findIndex((x) => x.name === v); return i < 0 ? 99 : i; };
  const list = shots.filter((s) => s.pageUrl === (page || pages[0])).sort((a, b) => a.browser.localeCompare(b.browser) || order(a.viewport) - order(b.viewport));
  const hasDiff = list.some((s) => s.diffPath);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect aria-label="Page" className="max-w-md" value={page} onChange={(e) => setPage(e.target.value)}>{pages.map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect>
        {hasDiff && <label className="flex items-center gap-2 text-sm"><Checkbox checked={showDiff} onCheckedChange={(c) => setShowDiff(!!c)} /> Highlight visual differences vs previous scan</label>}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {list.map((s) => {
          const src = fileUrl(showDiff && s.diffPath ? s.diffPath : s.path)!;
          return (
            <figure key={s.id} className="space-y-1.5">
              <button type="button" className="block h-64 w-full overflow-hidden rounded-lg border bg-muted cursor-zoom-in" onClick={() => setZoom(src)}>
                <img src={src} alt={`${s.viewport} ${s.browser} screenshot`} loading="lazy" className="w-full object-cover object-top" />
              </button>
              <figcaption className="text-xs"><span className="font-medium">{s.viewport}</span> <span className="text-muted-foreground">· {s.browser}{s.diffRatio !== null && ` · ${(s.diffRatio * 100).toFixed(1)}% changed`}</span></figcaption>
            </figure>
          );
        })}
      </div>
      {zoom && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/80 p-6" onClick={() => setZoom(null)} role="dialog" aria-label="Screenshot preview">
          <img src={zoom} alt="Full screenshot" className="mx-auto max-w-5xl rounded-lg" />
        </div>
      )}
    </div>
  );
}
