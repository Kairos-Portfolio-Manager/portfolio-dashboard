"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DefRow, Footnote, Hatch, Panel, PanelHead, RailBlock, ScreenGrid, Status } from "@/components/chrome";
import { PitchLabNav } from "@/components/pitch-lab/PitchLabNav";
import { REVIEW_STATUS_LABEL, fmtDate, fmtET, periodLabel, timeUntil, type PitchLabSnapshot, type ReviewIndexEntry } from "@/lib/pitch-lab";

interface ApiResponse {
  snapshot: PitchLabSnapshot | null;
  reviews: ReviewIndexEntry[];
}

function statusTone(status: ReviewIndexEntry["status"]): "pos" | "warn" | "muted" {
  if (status === "has_suggestions") return "pos";
  if (status === "insufficient_data") return "warn";
  return "muted";
}

function ReviewList({ reviews }: { reviews: ReviewIndexEntry[] }) {
  return (
    <Panel>
      <PanelHead title="Review periods" caption="One Mandate Review per month, newest first" />
      <table className="pm-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Result</th>
            <th className="pm-num-cell">Graded pitches</th>
            <th className="pm-num-cell">Independent weeks</th>
            <th className="pm-num-cell">Recommended</th>
            <th className="pm-num-cell">Watch</th>
            <th>Run</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">
                <Link href={`/pitch-lab/reviews/${r.id}`} style={{ color: "var(--link)" }}>
                  {periodLabel(r.period)}
                </Link>
              </td>
              <td>
                <Status tone={statusTone(r.status)}>{REVIEW_STATUS_LABEL[r.status] ?? r.status}</Status>
              </td>
              <td className="pm-num-cell">{r.gradedPitches ?? "—"}</td>
              <td className="pm-num-cell">{r.independentWeeks ?? "—"}</td>
              <td className="pm-num-cell">{r.recommended}</td>
              <td className="pm-num-cell">{r.watch}</td>
              <td className="pm-num" style={{ color: "var(--muted)" }}>{fmtDate(r.generatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export default function PitchLabReviewsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pitch-lab");
      const body = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Pitch Lab reviews");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const next = data?.snapshot?.schedule?.nextMandateReviewAt ?? null;
  const evidence = data?.snapshot?.evidenceBar;

  return (
    <>
      <PitchLabNav />
      <ScreenGrid
        main={
          error ? (
            <div className="p-6">
              <Hatch title="Reviews unavailable" note={error} />
            </div>
          ) : !data ? (
            <div className="p-6">
              <Hatch title="Loading…" />
            </div>
          ) : data.reviews.length ? (
            <ReviewList reviews={data.reviews} />
          ) : (
            <div className="p-6">
              <Hatch title="No review periods yet" note={next ? `The first Mandate Review runs ${fmtET(next)} (${timeUntil(next)}).` : undefined} />
            </div>
          )
        }
        rail={
          <>
            <RailBlock title="Schedule">
              <DefRow label="Next Mandate Review">{fmtET(next)}</DefRow>
              <DefRow label="Next weekly report">{fmtET(data?.snapshot?.schedule?.nextWeeklyReportAt)}</DefRow>
            </RailBlock>
            <RailBlock title="About reviews" grow>
              <Footnote label="What a review is">
                On the first Saturday of each month the Mandate Review checks which mandate metrics, the Mandate Score, and the
                model&apos;s conviction have gone with beating SPY. Its suggestions are only suggestions: nothing changes the
                mandate automatically.
              </Footnote>
              <Footnote label="Evidence bar">
                A review only makes suggestions once there are at least {evidence?.minGraded ?? 30} graded pitches across{" "}
                {evidence?.minWeeks ?? 8} independent weeks. Before that it is listed as &ldquo;Not enough data yet&rdquo;.
              </Footnote>
            </RailBlock>
          </>
        }
      />
    </>
  );
}
