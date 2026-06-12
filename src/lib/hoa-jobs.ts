// In-memory progress store for HOA-validator jobs. The app runs as a single
// long-lived Node container (see docs/DEPLOY.md), so a module-level map is
// enough to hand progress from the background job to the polling endpoint —
// no extra table, and it survives across requests in the same process. The
// authoritative result still lands in hoa_details; this only holds transient
// stage state. A lost map (server restart) just makes a running job read as
// "idle", which the client treats as finished and refreshes.

import type { HoaStage } from "./hoa";

export interface HoaJob {
  state: "running" | "done" | "error";
  stage: HoaStage;
  searchIndex?: number;
  message?: string; // populated when state === "error"
  rating?: number | null; // populated when state === "done"
  updatedAt: number;
}

const g = globalThis as unknown as { __hoaJobs?: Map<string, HoaJob> };
const jobs = g.__hoaJobs ?? new Map<string, HoaJob>();
if (!g.__hoaJobs) g.__hoaJobs = jobs;

export function getJob(id: string): HoaJob | undefined {
  return jobs.get(id);
}

export function isRunning(id: string): boolean {
  return jobs.get(id)?.state === "running";
}

export function startJob(id: string): void {
  jobs.set(id, { state: "running", stage: "starting", updatedAt: Date.now() });
}

export function updateJob(id: string, patch: Partial<HoaJob>): void {
  const cur = jobs.get(id) ?? { state: "running", stage: "starting" as HoaStage };
  jobs.set(id, { ...cur, ...patch, updatedAt: Date.now() });
}
