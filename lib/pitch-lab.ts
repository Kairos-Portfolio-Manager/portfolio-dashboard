/**
 * Pitch Lab — the website's view of the paper-pitch program.
 *
 * Shapes are mirrored by hand from the backend publishers (portfolio-manager):
 *   pitchlab:snapshot              lib/pitch-lab/dashboard-snapshot.js  (pitch-lab.snapshot.v2)
 *   pitchlab:mandate-reviews       lib/pitch-lab-review-publisher.js    (pitch-lab.review-history.v1)
 *   pitchlab:mandate-review:<id>   lib/pitch-lab/mandate-review.js      (pitch-lab.mandate-review.v1)
 * tests/pitch-lab.test.ts builds a real snapshot and review with the sibling
 * backend modules and fails on field drift. Everything here is paper only.
 */

export const SNAPSHOT_SCHEMA_VERSION = "pitch-lab.snapshot.v2";
export const REVIEW_HISTORY_SCHEMA_VERSION = "pitch-lab.review-history.v1";
export const REVIEW_ID_RE = /^mr_[0-9a-f]{20}$/;

export const SNAPSHOT_KEY = "pitchlab:snapshot";
export const REVIEW_INDEX_KEY = "pitchlab:mandate-reviews";
export const REVIEW_KEY_PREFIX = "pitchlab:mandate-review:";

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface ScoreCategory {
  id: string;
  label?: string;
  earned: number;
  scorable: number;
  max: number;
}

export interface ScoreMetric {
  id: string;
  label: string;
  category: string;
  status: string;
  percentile: number | null;
  peerCount: number;
  band: string | null;
  points: number | null;
  maxPoints: number;
}

export interface MandateScore {
  score: number | null;
  scale: number;
  status: "scored" | "unavailable";
  source: "at_pitch" | "derived";
  earned: number;
  scorable: number;
  metricsScored: number;
  metricsTotal: number;
  categories: ScoreCategory[];
  metrics: ScoreMetric[];
}

export interface LatestPitch {
  ticker: string;
  conviction: number;
  convictionScale: number;
  thesis: string;
  risk: string;
  mandateScore: MandateScore;
}

export interface RecentPitch {
  ticker: string;
  date: string;
  conviction: number;
  convictionScale: number;
  mandateScore: number | null;
  metricsScored: number;
  metricsTotal: number;
  categories: ScoreCategory[];
  excessReturn: Record<string, number | null>;
}

export interface ConvictionBucket {
  conviction: number;
  n: number;
  meanExcess: number | null;
  hitRate: number | null;
}

export interface ScoreboardEntry {
  horizonDays: number;
  graded: number;
  pending: number;
  beat: number;
  hitRate: number | null;
  meanExcess: number | null;
  medianExcess: number | null;
  independentWeeks: number;
  firstGradedDate: string | null;
  convictionBuckets: ConvictionBucket[];
  legacyConvictionBuckets: ConvictionBucket[];
}

export interface PitchLabSnapshot {
  schemaVersion: string;
  generatedAt: string;
  benchmark: string;
  horizons: number[];
  evidenceBar: { minGraded: number; minWeeks: number };
  convictionScale: number;
  schedule: { nextWeeklyReportAt: string; nextMandateReviewAt: string };
  program: {
    firstPitchDate: string | null;
    lastPitchDate: string | null;
    pitchDays: number;
    totalPitches: number;
    distinctTickers: number;
    convictionMix: Record<string, number>;
    legacyConvictionMix: Record<string, number> | null;
    avgMandateScore: number | null;
    repeatedTickers: { ticker: string; days: number }[];
  };
  latest: {
    date: string | null;
    pitched: number;
    selected: number | null;
    dropped: number | null;
    shortfall: number | null;
    status: string | null;
    pitches: LatestPitch[];
  };
  recent: RecentPitch[];
  days: { date: string; pitched: number; avgConviction: number | null; avgMandateScore: number | null }[];
  scoreboard: Record<string, ScoreboardEntry>;
}

/** Top-level snapshot fields this page reads; the cross-repo test pins them to the backend. */
export const SNAPSHOT_FIELDS = [
  "benchmark", "convictionScale", "days", "evidenceBar", "generatedAt", "horizons", "latest",
  "program", "recent", "schedule", "schemaVersion", "scoreboard",
] as const;

// ─── Mandate Review ──────────────────────────────────────────────────────────

export interface EvidenceHorizon {
  horizonDays: number;
  verdict: string;
  n: number | null;
  clusters: number | null;
  spearman: { rho: number | null; ci95: [number, number] | null };
  excessReturnPerSd: { estimate: number | null; ci95: [number, number] | null; qValue: number | null };
}

export interface MetricReview {
  metricId: string;
  label: string | null;
  currentPoints: number | null;
  higherIsBetter: boolean | null;
  confidenceLabel: "recommended" | "watch" | "no_change" | "unavailable";
  suggestedDirection: "more" | "less" | "review_direction" | null;
  directionConflict?: boolean;
  evidence: { horizons: EvidenceHorizon[] };
}

export interface ConvictionSummary {
  scale: number | null;
  overallVerdict: string;
  confidenceLabel: string;
  horizons: { horizonDays: number; verdict: string; n: number | null; clusters: number | null }[];
}

export interface MandateScoreSummary {
  overallVerdict: string;
  confidenceLabel: string;
  evidence: { horizons: EvidenceHorizon[] };
}

export interface MandateReview {
  id?: string;
  schemaVersion: string;
  generatedAt: string;
  period: string;
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
  mandateScore: MandateScoreSummary | null;
  metrics: MetricReview[];
  caveats: string[];
}

export interface ReviewIndexEntry {
  id: string;
  period: string;
  generatedAt: string;
  status: MandateReview["status"];
  gradedPitches: number | null;
  independentWeeks: number | null;
  recommended: number;
  watch: number;
}

export interface ReviewIndex {
  schemaVersion: string;
  publishedAt: string;
  reviews: ReviewIndexEntry[];
}

// ─── Reading what Redis returns ─────────────────────────────────────────────

/** Upstash returns parsed JSON for objects and a string otherwise. */
export function parseStored(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") return JSON.parse(raw);
  return raw;
}

/** The snapshot inside its `{ publishedAt, snapshot }` envelope, or null if absent or another version. */
export function snapshotFromEnvelope(raw: unknown): PitchLabSnapshot | null {
  const envelope = parseStored(raw) as { snapshot?: PitchLabSnapshot } | null;
  const snapshot = envelope?.snapshot ?? null;
  return snapshot?.schemaVersion === SNAPSHOT_SCHEMA_VERSION ? snapshot : null;
}

/** The review index, or an empty history when none has been published yet. */
export function reviewIndexFrom(raw: unknown): ReviewIndex | null {
  const index = parseStored(raw) as ReviewIndex | null;
  if (!index) return null;
  if (index.schemaVersion !== REVIEW_HISTORY_SCHEMA_VERSION || !Array.isArray(index.reviews)) return null;
  return index;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export const pct = (v: number | null | undefined, { signed = false, places = 1 } = {}): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(places);
  return signed && v > 0 ? `+${s}%` : `${s}%`;
};

export const score10 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(1);

/** "Sat, Nov 7 · 11:00 AM ET" */
export function fmtET(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const day = at.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
  const time = at.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return `${day} · ${time} ET`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

/** "in 3 days", "in 5 hours", "in 20 minutes", "due now" */
export function timeUntil(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "due now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 36) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(ms / 86_400_000);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** "2026-11" → "November 2026" */
export function periodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period ?? "");
  if (!match) return period ?? "—";
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface BeatTile {
  horizonDays: number;
  graded: number;
  beat: number;
  hitRate: number | null;
  pending: number;
}

/** One "beat SPY" figure per holding period, shortest first. */
export function beatTiles(snapshot: PitchLabSnapshot): BeatTile[] {
  return [...(snapshot.horizons ?? [])]
    .sort((a, b) => a - b)
    .map((h) => {
      const entry = snapshot.scoreboard?.[String(h)];
      return { horizonDays: h, graded: entry?.graded ?? 0, beat: entry?.beat ?? 0, hitRate: entry?.hitRate ?? null, pending: entry?.pending ?? 0 };
    });
}

export const REVIEW_STATUS_LABEL: Record<MandateReview["status"], string> = {
  insufficient_data: "Not enough data yet",
  has_suggestions: "Suggestions available",
  no_suggestions: "No significant findings",
};
