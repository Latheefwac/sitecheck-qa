import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ScanView } from "./view";

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 px-8 pt-20 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading scan…</div>}>
      <ScanView />
    </Suspense>
  );
}
