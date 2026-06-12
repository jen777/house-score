"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Ordered pipeline stages → label + how far along the bar should be. Mirrors the
// stages reported by the HOA-validator job.
const STAGE_META: Record<string, { label: string; pct: number }> = {
  starting: { label: "Preparing…", pct: 8 },
  searching: { label: "Searching the web…", pct: 35 },
  reading: { label: "Reading sources & ratings…", pct: 55 },
  writing: { label: "Writing the review…", pct: 75 },
  summarizing: { label: "Summarizing findings…", pct: 80 },
  saving: { label: "Saving results…", pct: 92 },
  done: { label: "Done", pct: 100 },
};

const POLL_MS = 2000;

type Status = "idle" | "running" | "error";

interface JobStatus {
  state: "idle" | "running" | "done" | "error";
  stage?: string;
  searchIndex?: number;
  message?: string;
}

export default function HoaValidatorButton({
  propertyId,
  hasResult,
  disabled,
}: {
  propertyId: string;
  hasResult: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [stage, setStage] = useState<string>("starting");
  const [searchIndex, setSearchIndex] = useState<number | undefined>();
  const [error, setError] = useState<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const endpoint = `/api/properties/${propertyId}/hoa`;

  // On mount, resume the progress UI if a job is already running (e.g. the user
  // reloaded the page mid-run). Cleans up the poll timer on unmount.
  useEffect(() => {
    alive.current = true;
    fetch(endpoint)
      .then((r) => r.json())
      .then((j: JobStatus) => {
        if (alive.current && j?.state === "running") {
          setStatus("running");
          setStage(j.stage ?? "starting");
          setSearchIndex(j.searchIndex);
          schedulePoll();
        }
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  function schedulePoll() {
    timer.current = setTimeout(poll, POLL_MS);
  }

  async function poll() {
    if (!alive.current) return;
    try {
      const res = await fetch(endpoint);
      const j: JobStatus = await res.json();
      if (!alive.current) return;

      if (j.state === "running") {
        setStage(j.stage ?? "starting");
        setSearchIndex(j.searchIndex);
        schedulePoll();
      } else if (j.state === "error") {
        setError(j.message ?? "HOA research failed");
        setStatus("error");
      } else {
        // "done" or "idle" — the result (if any) is in the DB; refresh to show it.
        setStatus("idle");
        router.refresh();
      }
    } catch {
      // Transient network error while polling — try again.
      if (alive.current) schedulePoll();
    }
  }

  async function run() {
    setStatus("running");
    setStage("starting");
    setSearchIndex(undefined);
    setError("");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      schedulePoll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "HOA research failed");
      setStatus("error");
    }
  }

  if (status === "running") {
    const meta = STAGE_META[stage] ?? STAGE_META.starting;
    const label =
      stage === "searching" && searchIndex
        ? `Searching the web (#${searchIndex})…`
        : meta.label;
    return (
      <div className="flex w-full flex-col gap-1 sm:w-56 sm:items-end">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand"
            aria-hidden
          />
          <span aria-live="polite">{label}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${meta.pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn" onClick={run} disabled={disabled}>
        {hasResult ? "Re-validate HOA" : "Validate HOA"}
      </button>
      {status === "error" ? (
        <span className="max-w-xs text-right text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}
