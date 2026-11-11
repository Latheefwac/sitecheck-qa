import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";

// Admin area: the full platform. Developer share pages (/share/…) live outside this group and never get the sidebar.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Suspense fallback={<aside className="hidden w-60 shrink-0 border-r bg-sidebar md:block" />}>
        <Sidebar />
      </Suspense>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
