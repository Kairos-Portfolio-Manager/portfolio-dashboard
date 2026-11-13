"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DefRow, Footnote, Hatch, Panel, PanelHead, RailBlock, ScreenGrid, Status } from "@/components/chrome";
import { PitchLabNav } from "@/components/pitch-lab/PitchLabNav";
import { REVIEW_STATUS_LABEL, fmtDate, fmtET, fmtLongDate, periodLabel, timeUntil, upcomingReviewAt, verdictLabel, type PitchLabSnapshot, type ReviewIndexEntry } from "@/lib/pitch-lab";

interface ApiResponse {
  snapshot: PitchLabSnapshot | null;
  reviews: ReviewIndexEntry[];
}

function statusTone(status: ReviewIndexEntry["status"]): "pos" | "warn" | "muted" {
  if (status === "has_suggestions") return "pos";
  if (status === "insufficient_data") return "warn";
  return "muted";
}

function NextReviewBanner({ next }: { next: string | null }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-5">
        <div>
          <p className="pm-label mb-1">Every Saturday · 11:00 AM ET</p>
          <p className="text-lg font-semibold" style={{ color: "var(--ink)" }}>
            Next Mandate Review is {next ? fmtLongDate(next) : "not scheduled"}
          </p>
        </div>
        {next && <p className="pm-label">{timeUntil(next)}</p>}
      </div>
    </Panel>
  );
}

function ReviewList({ reviews }: { reviews: ReviewIndexEntry[] }) {
  const router = useRouter();
  return (
    <Panel>
      <PanelHead title="Past reviews" caption="Newest first · click a review to open it" />
      <table className="pm-table">
        <thead>
          <tr>
            <th>Review</th>
            <th>Verdict</th>
            <th>Mandate Score</th>
            <th className="pm-num-cell">Graded pitches</th>
            <th className="pm-num-cell">Recommended</th>
            <th className="pm-num-cell">Watch</th>
            <th>Run</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((r) => {
            const href = `/pitch-lab/reviews/${r.id}`;
            return (
              <tr key={r.id} onClick={() => router.push(href)} style={{ cursor: "pointer" }}>
                <td className="font-medium">
                  <Link href={href} style={{ color: "var(--link)" }} onClick={(e) => e.stopPropagation()}>
                    {periodLabel(r.period)}
                  </Link>
                </td>
                <td>
                  <Status tone={statusTone(r.status)}>{REVIEW_STATUS_LABEL[r.status] ?? r.status}</Status>
                </td>
                <td style={{ color: "var(--ink-2)" }}>{r.mandateScoreVerdict ? verdictLabel(r.mandateScoreVerdict) : "—"}</td>
                <td className="pm-num-cell">{r.gradedPitches ?? "—"}</td>
                <td className="pm-num-cell">{r.recommended}</td>
                <td className="pm-num-cell">{r.watch}</td>
                <td className="pm-num" style={{ color: "var(--muted)" }}>{fmtDate(r.generatedAt)}</td>
              </tr>
            );
          })}
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

  const next = upcomingReviewAt(data?.snapshot?.schedule?.nextMandateReviewAt);
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
          ) : (
            <div className="space-y-px">
              <NextReviewBanner next={next} />
              {data.reviews.length ? (
                <ReviewList reviews={data.reviews} />
              ) : (
                <div className="p-6">
                  <Hatch title="No reviews yet" note={next ? `The first Mandate Review runs ${fmtET(next)} (${timeUntil(next)}).` : undefined} />
                </div>
              )}
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
                Every Saturday the Mandate Review checks which mandate metrics, the Mandate Score, and the
                model&apos;s conviction have gone with beating SPY. Its suggestions are only suggestions: nothing changes the
                mandate automatically.
              </Footnote>
              <Footnote label="Mandate Score column">
                Whether pitches with a higher Mandate Score went on to beat SPY: positive, negative, or inconclusive.
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
