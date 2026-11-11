import "server-only";
import { db, getSettings, listScans, updateScan } from "./db";
import { rerunFailed, runDiscovery, runTests } from "./engine/runner";

/**
 * In-process background job queue. Long-running scans execute outside the request lifecycle;
 * progress is persisted to SQLite and streamed over SSE. Survives HMR via globalThis.
 */
type Job = { kind: "discover" | "test" | "rerun"; scanId: string; then?: "test" };
const g = globalThis as unknown as { __qaJobs?: { queue: Job[]; running: number; booted: boolean } };
const state = (g.__qaJobs ??= { queue: [], running: 0, booted: false });

function boot() {
  if (state.booted) return;
  state.booted = true;
  // Scans interrupted by a server restart cannot resume mid-browser-session; mark them failed.
  for (const s of listScans(1000)) {
    if (["running", "discovering", "queued"].includes(s.status)) updateScan(s.id, { status: "failed", error: "Interrupted by server restart — re-run the scan", phase: "Interrupted" });
  }
  db();
}

export function enqueue(job: Job) {
  boot();
  if (job.kind !== "discover") updateScan(job.scanId, { status: "queued", phase: "Queued" });
  state.queue.push(job);
  pump();
}

export function queuePosition(scanId: string) {
  return state.queue.findIndex((j) => j.scanId === scanId);
}

export function dequeue(scanId: string) {
  const before = state.queue.length;
  state.queue = state.queue.filter((j) => j.scanId !== scanId);
  return before !== state.queue.length;
}

function pump() {
  const limit = Math.max(1, getSettings().concurrency);
  while (state.running < limit && state.queue.length) {
    const job = state.queue.shift()!;
    state.running++;
    (async () => {
      try {
        if (job.kind === "discover") {
          const ok = await runDiscovery(job.scanId);
          if (ok && job.then === "test") {
            state.queue.unshift({ kind: "test", scanId: job.scanId });
            updateScan(job.scanId, { status: "queued", phase: "Queued" });
          }
        } else if (job.kind === "test") await runTests(job.scanId);
        else await rerunFailed(job.scanId);
      } catch (e) {
        console.error("[qa-jobs]", e);
      } finally {
        state.running--;
        pump();
      }
    })();
  }
}

boot();
