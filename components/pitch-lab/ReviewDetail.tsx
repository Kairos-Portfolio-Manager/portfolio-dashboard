"use client";

import { useState } from "react";
import { Panel, PanelHead, Status } from "@/components/chrome";
import {
  REVIEW_STATUS_LABEL, fmtDate, pct, periodLabel,
  type ConvictionSummary, type EvidenceHorizon, type MandateReview, type MandateScoreSummary, type MetricReview,
} from "@/lib/pitch-lab";

const round2 = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));

function confidenceTone(label: string): "pos" | "neg" | "warn" | "muted" {
  if (label === "recommended") return "pos";
  if (label === "watch") return "warn";
  return "muted";
}

function directionLabel(dir: MetricReview["suggestedDirection"]): string {
  if (dir === "more") return "↑ more weight";
  if (dir === "less") return "↓ less weight";
  if (dir === "review_direction") return "⚠ review direction";
  return "—";
}

function verdictLabel(v: string): string {
  if (v === "positive") return "Positive";
  if (v === "negative") return "Negative";
  if (v === "inconclusive") return "Inconclusive";
  if (v === "insufficient_data") return "Insufficient data";
  return v ?? "—";
}

function StatusBanner({ review, publishedAt }: { review: MandateReview; publishedAt: string | null }) {
  const d = review.insufficientData;
  const tone: "pos" | "warn" | "muted" = review.status === "has_suggestions" ? "pos" : review.status === "insufficient_data" ? "warn" : "muted";
  return (
    <Panel>
      <div className="flex items-start justify-between p-5">
        <div>
          <p className="pm-label mb-2">{periodLabel(review.period)} review</p>
          <p className="text-base font-semibold">
            <Status tone={tone}>{REVIEW_STATUS_LABEL[review.status] ?? review.status}</Status>
          </p>
          {review.status === "insufficient_data" && d ? (
            <div className="mt-3 space-y-1 text-sm" style={{ color: "var(--ink-2)" }}>
              <p>
                {d.gradedPitches} graded pitch{d.gradedPitches === 1 ? "" : "es"} of {d.gradedPitches + (d.moreNeeded?.pitches ?? 0)} needed
              </p>
              <p>
                {d.independentWeeks} independent week{d.independentWeeks === 1 ? "" : "s"} of {d.independentWeeks + (d.moreNeeded?.weeks ?? 0)} needed
              </p>
            </div>
          ) : review.gradedPitches != null ? (
            <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
              Based on {review.gradedPitches} graded pitches over {review.independentWeeks ?? "?"} independent weeks
            </p>
          ) : null}
        </div>
        <p className="pm-label shrink-0 pl-6 pt-1">Generated {fmtDate(publishedAt ?? review.generatedAt)}</p>
      </div>
    </Panel>
  );
}

function ConvictionSection({ conviction }: { conviction: ConvictionSummary }) {
  return (
    <Panel>
      <PanelHead title="Conviction" caption={`How well the model's conviction (1–${conviction.scale ?? 10}) predicted beating SPY`} />
      <div className="p-4 pb-2">
        <div className="flex items-center gap-3">
          <span className="pm-label">Finding</span>
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>{verdictLabel(conviction.overallVerdict)}</span>
          <Status tone={confidenceTone(conviction.confidenceLabel)}>{conviction.confidenceLabel}</Status>
        </div>
      </div>
      <table className="w-full border-collapse text-xs" style={{ borderTop: "1px solid var(--rule)" }}>
        <thead>
          <tr style={{ background: "var(--panel-alt)", borderBottom: "1px solid var(--rule-head)" }}>
            <th className="px-4 py-2 text-left pm-label">Horizon</th>
            <th className="px-4 py-2 text-left pm-label">Verdict</th>
            <th className="px-4 py-2 text-right pm-label">n</th>
            <th className="px-4 py-2 text-right pm-label">Weeks</th>
          </tr>
        </thead>
        <tbody>
          {conviction.horizons.map((h) => (
            <tr key={h.horizonDays} style={{ borderBottom: "1px solid var(--rule-row)" }}>
              <td className="px-4 py-2 pm-num">{h.horizonDays}d</td>
              <td className="px-4 py-2">{verdictLabel(h.verdict)}</td>
              <td className="px-4 py-2 text-right pm-num">{h.n ?? "—"}</td>
              <td className="px-4 py-2 text-right pm-num">{h.clusters ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function EvidenceTable({ horizons }: { horizons: EvidenceHorizon[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr style={{ borderBottom: "1px solid var(--rule)" }}>
          <th className="py-1 text-left pm-label">Horizon</th>
          <th className="py-1 text-left pm-label">Verdict</th>
          <th className="py-1 text-right pm-label">ρ (Spearman)</th>
          <th className="py-1 text-right pm-label">Excess ret/SD</th>
          <th className="py-1 text-right pm-label">q-value</th>
          <th className="py-1 text-right pm-label">n</th>
        </tr>
      </thead>
      <tbody>
        {horizons.map((h) => (
          <tr key={h.horizonDays} style={{ borderBottom: "1px solid var(--rule-row)" }}>
            <td className="py-1 pm-num">{h.horizonDays}d</td>
            <td className="py-1">{verdictLabel(h.verdict)}</td>
            <td className="py-1 text-right pm-num">
              {round2(h.spearman.rho)}
              {h.spearman.ci95 && <span style={{ color: "var(--muted)" }}> [{round2(h.spearman.ci95[0])}, {round2(h.spearman.ci95[1])}]</span>}
            </td>
            <td className="py-1 text-right pm-num">
              {pct(h.excessReturnPerSd.estimate, { signed: true })}
              {h.excessReturnPerSd.ci95 && (
                <span style={{ color: "var(--muted)" }}> [{pct(h.excessReturnPerSd.ci95[0], { signed: true })}, {pct(h.excessReturnPerSd.ci95[1], { signed: true })}]</span>
              )}
            </td>
            <td className="py-1 text-right pm-num">{round2(h.excessReturnPerSd.qValue)}</td>
            <td className="py-1 text-right pm-num">{h.n ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MandateScoreSection({ summary }: { summary: MandateScoreSummary }) {
  return (
    <Panel>
      <PanelHead title="Mandate Score" caption="Did a higher Mandate Score (0–10) go with beating SPY?" />
      <div className="p-4 pb-2">
        <div className="flex items-center gap-3">
          <span className="pm-label">Finding</span>
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>{verdictLabel(summary.overallVerdict)}</span>
          <Status tone={confidenceTone(summary.confidenceLabel)}>{summary.confidenceLabel}</Status>
        </div>
      </div>
      <div className="px-4 pb-4">
        <EvidenceTable horizons={summary.evidence.horizons} />
      </div>
    </Panel>
  );
}

function MetricRow({ metric: m }: { metric: MetricReview }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr style={{ borderBottom: "1px solid var(--rule-row)", cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <td className="px-4 py-2">
          <span className="font-medium">{m.label ?? m.metricId}</span>
          <span className="ml-2 pm-label">{m.metricId}</span>
        </td>
        <td className="px-4 py-2 text-right pm-num">{m.currentPoints == null ? "—" : (m.currentPoints / 10).toFixed(2)}</td>
        <td className="px-4 py-2">
          <Status tone={confidenceTone(m.confidenceLabel)}>{m.confidenceLabel}</Status>
        </td>
        <td className="px-4 py-2" style={{ color: m.suggestedDirection ? "var(--ink)" : "var(--muted)" }}>
          {m.suggestedDirection ? directionLabel(m.suggestedDirection) : "—"}
        </td>
      </tr>
      {open && m.evidence.horizons.length > 0 && (
        <tr style={{ borderBottom: "1px solid var(--rule)" }}>
          <td colSpan={4} className="bg-[var(--panel-alt)] px-6 py-3">
            <EvidenceTable horizons={m.evidence.horizons} />
          </td>
        </tr>
      )}
    </>
  );
}

function MetricsTable({ metrics }: { metrics: MetricReview[] }) {
  const order = { recommended: 0, watch: 1, no_change: 2, unavailable: 3 };
  const sorted = [...metrics].sort((a, b) => (order[a.confidenceLabel] ?? 4) - (order[b.confidenceLabel] ?? 4));
  return (
    <Panel>
      <PanelHead title="Metrics" caption="Mandate metrics: statistical findings and suggested weight changes" />
      <table className="w-full border-collapse text-xs" style={{ borderTop: "1px solid var(--rule)" }}>
        <thead>
          <tr style={{ background: "var(--panel-alt)", borderBottom: "1px solid var(--rule-head)" }}>
            <th className="px-4 py-2 text-left pm-label">Metric</th>
            <th className="px-4 py-2 text-right pm-label">Current pts /10</th>
            <th className="px-4 py-2 text-left pm-label">Finding</th>
            <th className="px-4 py-2 text-left pm-label">Suggested</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <MetricRow key={m.metricId} metric={m} />
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs" style={{ color: "var(--muted)", borderTop: "1px solid var(--rule-soft)" }}>
        Suggestions only. No mandate change is applied automatically. Click a metric for its evidence.
      </p>
    </Panel>
  );
}

function CaveatsSection({ caveats }: { caveats: string[] }) {
  return (
    <Panel>
      <PanelHead title="Caveats" caption="Limitations and assumptions" />
      <ul style={{ borderTop: "1px solid var(--rule)" }}>
        {caveats.map((c, i) => (
          <li key={i} className="px-4 py-3 text-sm leading-6" style={{ color: "var(--ink-2)", borderBottom: "1px solid var(--rule-soft)" }}>
            {c}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** One review period, in full. */
export function ReviewDetail({ review, publishedAt }: { review: MandateReview; publishedAt: string | null }) {
  return (
    <div className="space-y-px">
      <StatusBanner review={review} publishedAt={publishedAt} />
      {review.conviction && <ConvictionSection conviction={review.conviction} />}
      {review.mandateScore && <MandateScoreSection summary={review.mandateScore} />}
      {review.metrics.length > 0 && <MetricsTable metrics={review.metrics} />}
      {review.caveats.length > 0 && <CaveatsSection caveats={review.caveats} />}
    </div>
  );
}
