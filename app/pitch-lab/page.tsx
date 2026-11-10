"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { DefRow, Footnote, Hatch, Metric, MetricStrip, Nil, Panel, PanelHead, RailBlock, ScreenGrid, Status } from "@/components/chrome";
import { PitchLabNav } from "@/components/pitch-lab/PitchLabNav";
import { ScoreBar, ScoreBreakdown, ScoreFigure } from "@/components/pitch-lab/ScoreBreakdown";
import {
  REVIEW_STATUS_LABEL, beatTiles, fmtDate, fmtET, pct, periodLabel, score10, timeUntil,
  type LatestPitch, type PitchLabSnapshot, type RecentPitch, type ReviewIndexEntry,
} from "@/lib/pitch-lab";

interface ApiResponse {
  snapshot: PitchLabSnapshot | null;
  reviews: ReviewIndexEntry[];
}

// ─── Status strip ────────────────────────────────────────────────────────────

function StatusStrip({ snapshot }: { snapshot: PitchLabSnapshot }) {
  const tiles = beatTiles(snapshot);
  const review = snapshot.schedule?.nextMandateReviewAt ?? null;
  return (
    <MetricStrip columns={2 + tiles.length}>
      <Metric
        label="Pitches"
        value={snapshot.program.totalPitches}
        sub={snapshot.program.firstPitchDate ? `since ${fmtDate(snapshot.program.firstPitchDate)} · ${snapshot.program.distinctTickers} tickers` : "none yet"}
      />
      {tiles.map((t) => (
        <Metric
          key={t.horizonDays}
          label={`Beat ${snapshot.benchmark} · ${t.horizonDays} days`}
          value={t.graded ? `${t.beat} of ${t.graded}` : <Nil />}
          muted={!t.graded}
          tone={t.hitRate == null ? undefined : t.hitRate > 0.5 ? "pos" : t.hitRate < 0.5 ? "neg" : undefined}
          sub={t.graded ? `${pct(t.hitRate, { places: 0 })} · ${t.pending} not graded yet` : `${t.pending} waiting to be graded`}
        />
      ))}
      <Metric label="Next review" value={review ? fmtET(review).split(" · ")[0] : <Nil />} sub={review ? `${fmtET(review).split(" · ")[1]} · ${timeUntil(review)}` : undefined} />
    </MetricStrip>
  );
}

// ─── Latest pitches ──────────────────────────────────────────────────────────

function LatestPitchRow({ pitch }: { pitch: LatestPitch }) {
  const [open, setOpen] = useState(false);
  const s = pitch.mandateScore;
  return (
    <Fragment>
      <tr onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }} aria-expanded={open}>
        <td className="font-medium" style={{ color: "var(--ink)" }}>
          <span className="mr-1.5" style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
          {pitch.ticker}
        </td>
        <td className="pm-num-cell">
          <ScoreFigure score={s.score} metricsScored={s.metricsScored} metricsTotal={s.metricsTotal} />
        </td>
        <td style={{ width: 140 }}>{s.score == null ? <Nil /> : <ScoreBar categories={s.categories} />}</td>
        <td className="pm-num-cell">
          {pitch.conviction}
          <span style={{ color: "var(--muted)" }}>/{pitch.convictionScale}</span>
        </td>
        <td className="pm-prose-cell" style={{ color: "var(--ink-2)" }}>{pitch.thesis}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: "var(--panel-alt)", padding: "14px 18px 18px 32px" }}>
            <ScoreBreakdown score={s} />
            {pitch.risk && (
              <p className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
                <span className="pm-label mr-2">Main risk</span>
                {pitch.risk}
              </p>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function LatestPitches({ snapshot }: { snapshot: PitchLabSnapshot }) {
  const latest = snapshot.latest;
  return (
    <Panel>
      <PanelHead
        title="Latest pitches"
        caption={latest.date ? `${fmtDate(latest.date)} · ${latest.pitched} pitched${latest.dropped ? ` · ${latest.dropped} dropped` : ""}` : undefined}
        right={<span className="pm-label">Click a pitch for its score breakdown</span>}
      />
      {latest.pitches.length ? (
        <table className="pm-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="pm-num-cell">Mandate /10</th>
              <th>A · B · C · D</th>
              <th className="pm-num-cell">Conviction</th>
              <th>Thesis</th>
            </tr>
          </thead>
          <tbody>
            {latest.pitches.map((p) => (
              <LatestPitchRow key={p.ticker} pitch={p} />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="p-6">
          <Hatch title="No pitches yet" />
        </div>
      )}
    </Panel>
  );
}

// ─── Recent pitches with results ─────────────────────────────────────────────

function Excess({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "var(--disabled)" }}>pending</span>;
  return <Status tone={value > 0 ? "pos" : value < 0 ? "neg" : "muted"}>{pct(value, { signed: true })}</Status>;
}

function RecentPitches({ snapshot }: { snapshot: PitchLabSnapshot }) {
  const horizons = [...snapshot.horizons].sort((a, b) => a - b);
  const rows: RecentPitch[] = snapshot.recent ?? [];
  if (!rows.length) return null;
  return (
    <Panel>
      <PanelHead title="Recent pitches" caption={`Return vs ${snapshot.benchmark} after costs, at each holding period`} />
      <table className="pm-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Ticker</th>
            <th className="pm-num-cell">Mandate /10</th>
            <th className="pm-num-cell">Conviction</th>
            {horizons.map((h) => (
              <th key={h} className="pm-num-cell">{h}d</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.date}-${r.ticker}-${i}`}>
              <td className="pm-num" style={{ color: "var(--muted)" }}>{fmtDate(r.date)}</td>
              <td className="font-medium" style={{ color: "var(--ink)" }}>{r.ticker}</td>
              <td className="pm-num-cell">
                <ScoreFigure score={r.mandateScore} metricsScored={r.metricsScored} metricsTotal={r.metricsTotal} />
              </td>
              <td className="pm-num-cell">
                {r.conviction}
                <span style={{ color: "var(--muted)" }}>/{r.convictionScale}</span>
              </td>
              {horizons.map((h) => (
                <td key={h} className="pm-num-cell">
                  <Excess value={r.excessReturn?.[String(h)] ?? null} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ─── Rail ────────────────────────────────────────────────────────────────────

function Rail({ snapshot, reviews }: { snapshot: PitchLabSnapshot | null; reviews: ReviewIndexEntry[] }) {
  const latestReview = reviews[0] ?? null;
  return (
    <>
      <RailBlock title="Reviews" right={<Link href="/pitch-lab/reviews" className="pm-label" style={{ color: "var(--link)" }}>All periods →</Link>}>
        <DefRow label="Next Mandate Review">{fmtET(snapshot?.schedule?.nextMandateReviewAt)}</DefRow>
        <DefRow label="Next weekly report">{fmtET(snapshot?.schedule?.nextWeeklyReportAt)}</DefRow>
        <DefRow label="Latest review">
          {latestReview ? (
            <Link href={`/pitch-lab/reviews/${latestReview.id}`} style={{ color: "var(--link)" }}>
              {periodLabel(latestReview.period)} · {REVIEW_STATUS_LABEL[latestReview.status] ?? latestReview.status}
            </Link>
          ) : (
            "None yet"
          )}
        </DefRow>
      </RailBlock>
      {snapshot && (
        <RailBlock title="Program">
          <DefRow label="First pitch">{fmtDate(snapshot.program.firstPitchDate)}</DefRow>
          <DefRow label="Last pitch">{fmtDate(snapshot.program.lastPitchDate)}</DefRow>
          <DefRow label="Pitch days">{snapshot.program.pitchDays}</DefRow>
          <DefRow label="Avg Mandate Score">{snapshot.program.avgMandateScore == null ? "—" : `${score10(snapshot.program.avgMandateScore)}/10`}</DefRow>
          <DefRow label="Evidence bar">
            {snapshot.evidenceBar.minGraded} graded · {snapshot.evidenceBar.minWeeks} weeks
          </DefRow>
        </RailBlock>
      )}
      <RailBlock title="Reading the scores" grow>
        <Footnote label="Mandate Score /10">
          The mandate&apos;s points table (A revenue 2.5 · B earnings 3 · C profitability, valuation, balance sheet 3 · D ownership 1.5),
          applied by code to each pitch&apos;s industry-peer ranks. Metrics that could not be ranked are left out and the score is
          rescaled over the rest; the small figure beside it is how many of the 9 metrics were scored. The bar shows points earned
          (dark), scorable but not earned (grey), and not scorable (light).
        </Footnote>
        <Footnote label="Conviction /10">
          The model&apos;s own judgement on a fixed 1–10 rubric. It never sees the Mandate Score. Pitches before the switch keep
          their original 1–5 rating and are never rescaled.
        </Footnote>
        {snapshot && <Footnote label="As of">{fmtDate(snapshot.generatedAt)}</Footnote>}
      </RailBlock>
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PitchLabStatusPage() {
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
      setError(err instanceof Error ? err.message : "Failed to load Pitch Lab data");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <>
        <PitchLabNav />
        <div className="p-8">
          <Hatch title="Pitch Lab unavailable" note={error} />
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PitchLabNav />
        <div className="p-8">
          <Hatch title="Loading…" />
        </div>
      </>
    );
  }

  const { snapshot, reviews } = data;
  return (
    <>
      <PitchLabNav />
      {snapshot && <StatusStrip snapshot={snapshot} />}
      <ScreenGrid
        main={
          snapshot ? (
            <div className="space-y-px">
              <LatestPitches snapshot={snapshot} />
              <RecentPitches snapshot={snapshot} />
            </div>
          ) : (
            <div className="p-6">
              <Hatch title="No Pitch Lab snapshot yet" note="The snapshot is published after each evening's pitch and grading cycle." />
            </div>
          )
        }
        rail={<Rail snapshot={snapshot} reviews={reviews} />}
      />
    </>
  );
}
