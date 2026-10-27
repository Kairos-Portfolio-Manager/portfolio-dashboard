"use client";

import { useCallback, useEffect, useState } from "react";
import { DefRow, Footnote, Hatch, Panel, PanelHead, RailBlock, ScreenGrid, Status } from "@/components/chrome";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EvidenceHorizon {
  horizonDays: number;
  verdict: string;
  n: number | null;
  clusters: number | null;
  spearman: { rho: number | null; ci95: [number, number] | null };
  excessReturnPerSd: { estimate: number | null; ci95: [number, number] | null; qValue: number | null };
}

interface MetricReview {
  metricId: string;
  label: string | null;
  currentPoints: number | null;
  higherIsBetter: boolean | null;
  confidenceLabel: "recommended" | "watch" | "no_change" | "unavailable";
  suggestedDirection: "more" | "less" | "review_direction" | null;
  evidence: { horizons: EvidenceHorizon[] };
}

interface ConvictionHorizon {
  horizonDays: number;
  verdict: string;
  n: number | null;
  clusters: number | null;
}

interface ConvictionSummary {
  overallVerdict: string;
  confidenceLabel: string;
  horizons: ConvictionHorizon[];
}

interface MandateReview {
  schemaVersion: string;
  generatedAt: string;
  agentId: string;
  status: "insufficient_data" | "has_suggestions" | "no_suggestions";
  gradedPitches?: number;
  independentWeeks?: number;
  insufficientData?: {
    gradedPitches: number;
    independentWeeks: number;
    moreNeeded: { pitches: number; weeks: number };
    peerCoverageGaps?: { metricId: string; rankedShare: number | null }[];
  };
  conviction: ConvictionSummary | null;
  metrics: MetricReview[];
  caveats: string[];
}

interface ScoreboardEntry {
  horizonDays: number;
  graded: number;
  hitRate: number | null;
  meanExcess: number | null;
}

interface PitchLabSnapshot {
  schemaVersion: string;
  generatedAt: string;
  horizons: number[];
  program: {
    totalPitches: number;
    lastPitchDate: string | null;
    firstPitchDate: string | null;
  };
  scoreboard: Record<string, ScoreboardEntry>;
}

interface ApiResponse {
  review: MandateReview | null;
  publishedAt: string | null;
  snapshot: PitchLabSnapshot | null;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const pct = (v: number | null, { signed = false } = {}): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(1);
  return signed && v > 0 ? `+${s}%` : `${s}%`;
};

const round2 = (v: number | null): string =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function confidenceTone(label: string): "pos" | "neg" | "warn" | "muted" {
  if (label === "recommended") return "pos";
  if (label === "watch") return "warn";
  if (label === "no_change") return "muted";
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBanner({ review, publishedAt }: { review: MandateReview; publishedAt: string | null }) {
  if (review.status === "insufficient_data") {
    const d = review.insufficientData;
    return (
      <Panel>
        <div className="p-5">
          <p className="pm-label mb-2">Status</p>
          <p className="text-base font-semibold" style={{ color: "var(--warn)" }}>
            Insufficient data for mandate suggestions
          </p>
          {d && (
            <div className="mt-3 space-y-1 text-sm" style={{ color: "var(--ink-2)" }}>
              <p>
                {d.gradedPitches} graded pitch{d.gradedPitches === 1 ? "" : "es"} of{" "}
                {d.gradedPitches + (d.moreNeeded?.pitches ?? 0)} needed
              </p>
              <p>
                {d.independentWeeks} independent week{d.independentWeeks === 1 ? "" : "s"} of{" "}
                {d.independentWeeks + (d.moreNeeded?.weeks ?? 0)} needed
              </p>
            </div>
          )}
          {publishedAt && (
            <p className="pm-label mt-4">Generated {fmtDate(publishedAt)}</p>
          )}
        </div>
      </Panel>
    );
  }

  const tone: "pos" | "warn" | "muted" =
    review.status === "has_suggestions" ? "pos" : "muted";
  const label =
    review.status === "has_suggestions"
      ? "Suggestions available"
      : "No significant findings this period";

  return (
    <Panel>
      <div className="flex items-start justify-between p-5">
        <div>
          <p className="pm-label mb-2">Status</p>
          <p className="text-base font-semibold">
            <Status tone={tone}>{label}</Status>
          </p>
          {review.gradedPitches != null && (
            <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
              Based on {review.gradedPitches} graded pitches over {review.independentWeeks ?? "?"} independent weeks
            </p>
          )}
        </div>
        {publishedAt && (
          <p className="pm-label shrink-0 pl-6 pt-1">Generated {fmtDate(publishedAt)}</p>
        )}
      </div>
    </Panel>
  );
}

function ConvictionSection({ conviction }: { conviction: ConvictionSummary }) {
  return (
    <Panel>
      <PanelHead title="Conviction" caption="How well conviction (1–5) predicted outperformance" />
      <div className="p-4 pb-2">
        <div className="flex items-center gap-3">
          <span className="pm-label">Finding</span>
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            {verdictLabel(conviction.overallVerdict)}
          </span>
          <Status tone={confidenceTone(conviction.confidenceLabel)}>
            {conviction.confidenceLabel}
          </Status>
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

function MetricsTable({ metrics }: { metrics: MetricReview[] }) {
  const sorted = [...metrics].sort((a, b) => {
    const order = { recommended: 0, watch: 1, no_change: 2, unavailable: 3 };
    return (order[a.confidenceLabel] ?? 4) - (order[b.confidenceLabel] ?? 4);
  });

  return (
    <Panel>
      <PanelHead title="Metrics" caption="Mandate metrics — statistical findings and suggested weight changes" />
      <table className="w-full border-collapse text-xs" style={{ borderTop: "1px solid var(--rule)" }}>
        <thead>
          <tr style={{ background: "var(--panel-alt)", borderBottom: "1px solid var(--rule-head)" }}>
            <th className="px-4 py-2 text-left pm-label">Metric</th>
            <th className="px-4 py-2 text-right pm-label">Current pts</th>
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
        Suggestions only. No mandate change is applied automatically.
      </p>
    </Panel>
  );
}

function MetricRow({ metric: m }: { metric: MetricReview }) {
  const [open, setOpen] = useState(false);
  const tone = confidenceTone(m.confidenceLabel);

  return (
    <>
      <tr
        style={{ borderBottom: "1px solid var(--rule-row)", cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-4 py-2">
          <span className="font-medium">{m.label ?? m.metricId}</span>
          <span className="ml-2 pm-label">{m.metricId}</span>
        </td>
        <td className="px-4 py-2 text-right pm-num">{m.currentPoints ?? "—"}</td>
        <td className="px-4 py-2">
          <Status tone={tone}>{m.confidenceLabel}</Status>
        </td>
        <td className="px-4 py-2" style={{ color: m.suggestedDirection ? "var(--ink)" : "var(--muted)" }}>
          {m.suggestedDirection ? directionLabel(m.suggestedDirection) : "—"}
        </td>
      </tr>
      {open && m.evidence.horizons.length > 0 && (
        <tr style={{ borderBottom: "1px solid var(--rule)" }}>
          <td colSpan={4} className="bg-[var(--panel-alt)] px-6 py-3">
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
                {m.evidence.horizons.map((h) => (
                  <tr key={h.horizonDays} style={{ borderBottom: "1px solid var(--rule-row)" }}>
                    <td className="py-1 pm-num">{h.horizonDays}d</td>
                    <td className="py-1">{verdictLabel(h.verdict)}</td>
                    <td className="py-1 text-right pm-num">
                      {round2(h.spearman.rho)}
                      {h.spearman.ci95 && (
                        <span style={{ color: "var(--muted)" }}>
                          {" "}[{round2(h.spearman.ci95[0])}, {round2(h.spearman.ci95[1])}]
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right pm-num">
                      {pct(h.excessReturnPerSd.estimate, { signed: true })}
                      {h.excessReturnPerSd.ci95 && (
                        <span style={{ color: "var(--muted)" }}>
                          {" "}[{pct(h.excessReturnPerSd.ci95[0], { signed: true })}, {pct(h.excessReturnPerSd.ci95[1], { signed: true })}]
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right pm-num">{round2(h.excessReturnPerSd.qValue)}</td>
                    <td className="py-1 text-right pm-num">{h.n ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
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

function SnapshotRail({ snapshot }: { snapshot: PitchLabSnapshot }) {
  const horizons = (snapshot.horizons ?? []).map(String).sort((a, b) => Number(a) - Number(b));
  return (
    <RailBlock title="Pitch Lab overview">
      <DefRow label="Total pitches">{snapshot.program?.totalPitches ?? "—"}</DefRow>
      <DefRow label="First pitch">{fmtDate(snapshot.program?.firstPitchDate ?? null)}</DefRow>
      <DefRow label="Last pitch">{fmtDate(snapshot.program?.lastPitchDate ?? null)}</DefRow>
      {horizons.map((h) => {
        const entry = snapshot.scoreboard?.[h];
        return (
          <DefRow key={h} label={`${h}d graded`}>
            <span className="pm-num">{entry?.graded ?? "—"}</span>
            {entry?.hitRate != null && (
              <span className="ml-2" style={{ color: "var(--muted)" }}>
                {pct(entry.hitRate)} beat SPY
              </span>
            )}
          </DefRow>
        );
      })}
      <Footnote label="As of">{fmtDate(snapshot.generatedAt)}</Footnote>
    </RailBlock>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PitchLabPage() {
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
      <div className="p-8">
        <Hatch
          title="Pitch Lab unavailable"
          note={error}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <Hatch title="Loading…" />
      </div>
    );
  }

  const { review, publishedAt, snapshot } = data;

  if (!review) {
    return (
      <ScreenGrid
        main={
          <div className="p-6">
            <Hatch
              title="No mandate review yet"
              note="The monthly mandate review runs on the first Saturday of each month once Pitch Lab has collected enough data (30 graded pitches across 8 independent weeks). Check back after the first full month of pitching."
            />
          </div>
        }
        rail={snapshot ? <SnapshotRail snapshot={snapshot} /> : <RailBlock title="Pitch Lab overview"><p className="pm-label p-4">No data yet</p></RailBlock>}
      />
    );
  }

  return (
    <ScreenGrid
      main={
        <div className="space-y-px">
          <StatusBanner review={review} publishedAt={publishedAt} />
          {review.conviction && <ConvictionSection conviction={review.conviction} />}
          {review.metrics.length > 0 && <MetricsTable metrics={review.metrics} />}
          {review.caveats.length > 0 && <CaveatsSection caveats={review.caveats} />}
        </div>
      }
      rail={
        snapshot ? (
          <SnapshotRail snapshot={snapshot} />
        ) : (
          <RailBlock title="Pitch Lab overview">
            <p className="pm-label p-4">Snapshot not available</p>
          </RailBlock>
        )
      }
    />
  );
}
