import type { Metadata } from "next";
import { Suspense } from "react";
import { DevShareView } from "./view";

export const metadata: Metadata = {
  title: "Developer issues",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <DevShareView />
    </Suspense>
  );
}
