"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Link2, Radar } from "lucide-react";
import { PageBody, PageHeader } from "@/components/page-header";
import { ShareDialog } from "@/components/share-dialog";
import { HandoverBadge, ScanStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Project } from "@/lib/types";
import { api, fmtDate, scoreColor } from "@/lib/utils";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [share, setShare] = useState<Project | null>(null);
  const load = () => api<{ projects: Project[] }>("/api/projects").then((x) => setProjects(x.projects)).catch(() => setProjects([]));
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader title="Projects" description="One project per website. Share a project's issues with a developer through a private link." actions={<Button asChild><Link href="/scan"><Radar /> New scan</Link></Button>} />
      <PageBody>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">Website</th><th className="px-4 py-2.5 font-medium">Scans</th><th className="px-4 py-2.5 font-medium">Latest scan</th><th className="px-4 py-2.5 font-medium">Score</th><th className="px-4 py-2.5 font-medium">Handover</th><th className="px-4 py-2.5 font-medium">Developer links</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody>
              {projects === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
              {projects?.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No projects yet. Run a scan to create one.</td></tr>}
              {projects?.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium">{p.latestScan ? <Link href={`/scans/${p.latestScan.id}`} className="hover:underline">{p.origin}</Link> : p.origin}</td>
                  <td className="px-4 py-2.5 tabular-nums">{p.scanCount}</td>
                  <td className="px-4 py-2.5 text-xs">{p.latestScan ? <span className="flex items-center gap-2">{fmtDate(p.latestScan.createdAt)} <ScanStatusBadge status={p.latestScan.status} /></span> : "—"}</td>
                  <td className={`px-4 py-2.5 font-semibold tabular-nums ${scoreColor(p.latestScan?.overall)}`}>{p.latestScan?.overall ?? "—"}</td>
                  <td className="px-4 py-2.5"><HandoverBadge status={p.latestScan?.handoverStatus} /></td>
                  <td className="px-4 py-2.5 tabular-nums">{p.activeLinks} active</td>
                  <td className="px-4 py-2.5 text-right"><Button size="sm" variant="outline" onClick={() => setShare(p)}><Link2 /> Share</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
      {share && <ShareDialog websiteId={share.id} origin={share.origin} open onOpenChange={(o) => { if (!o) { setShare(null); load(); } }} />}
    </>
  );
}
