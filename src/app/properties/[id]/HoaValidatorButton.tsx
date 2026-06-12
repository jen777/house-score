"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Ordered pipeline stages → label + how far along the bar should be. Mirrors the
// stages emitted by researchHoa / the streaming route handler.
const STAGE_META: Record<string, { label: string; pct: number }> = {
  starting: { label: "Preparing…", pct: 8 },
  searching: { label: "Searching the web…", pct: 35 },
  reading: { label: "Reading sources & ratings…", pct: 55 },
  writing: { label: "Writing the review…", pct: 75 },
  summarizing: { label: "Summarizing findings…", pct: 80 },
  saving: { label: "Saving results…", pct: 92 },
  done: { label: "Done", pct: 100 },
};

type Status = "idle" | "running" | "error";

interface ProgressEvent {
  type: "progress" | "done" | "error";
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

  async function run() {
    setStatus("running");
    setStage("starting");
    setSearchIndex(undefined);
    setError("");

    try {
      const res = await fetch(`/api/properties/${propertyId}/hoa`, {
        method: "POST",
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      // Read newline-delimited JSON events as they stream in.
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: ProgressEvent;
          try {
            ev = JSON.parse(line) as ProgressEvent;
          } catch {
            continue;
          }
          if (ev.type === "progress" && ev.stage) {
            setStage(ev.stage);
            setSearchIndex(ev.searchIndex);
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? "HOA research failed");
          } else if (ev.type === "done") {
            done = true;
            setStage("done");
          }
        }
      }

      if (!done) throw new Error("HOA research ended unexpectedly");

      // Re-fetch the server component so the new findings render.
      router.refresh();
      setStatus("idle");
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
