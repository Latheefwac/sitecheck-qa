"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FolderKanban, GitCompare, History, LayoutDashboard, LogOut, Menu, Moon, Radar, Settings, ShieldCheck, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/scan", label: "New Scan", icon: Radar },
  { href: "/scans", label: "Scan History", icon: History },
  { href: "/projects", label: "Projects & Sharing", icon: FolderKanban },
  { href: "/compare", label: "Compare Reports", icon: GitCompare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  // The mobile menu is open only for the path it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = (v: boolean) => setOpenOn(v ? path : null);
  const router = useRouter();
  const [gate, setGate] = useState(false);
  useEffect(() => {
    fetch("/api/auth/status").then((r) => r.json()).then((x: { gate?: boolean }) => setGate(!!x.gate)).catch(() => {});
  }, []);
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const content = (
    <>
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ShieldCheck className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Sitecheck QA</div>
          <div className="text-[10px] text-muted-foreground">Website quality platform</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2" aria-label="Main">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href) && !(n.href === "/scan" && path.startsWith("/scans"));
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", active && "bg-accent font-medium text-foreground")}>
              <n.icon className="size-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-2">
        <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer">
          {mounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {mounted ? (resolvedTheme === "dark" ? "Light theme" : "Dark theme") : "Theme"}
        </button>
        {gate && (
          <button type="button" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer">
            <LogOut className="size-4" /> Sign out
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b bg-background/90 px-4 backdrop-blur md:hidden">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4" /> Sitecheck QA</div>
        <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-md p-1.5 hover:bg-accent cursor-pointer">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-sidebar transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>{content}</aside>
    </>
  );
}
