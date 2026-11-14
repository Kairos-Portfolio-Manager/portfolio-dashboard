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

export interface Performer {
  ticker: string;
  pitchDate: string;
  /** The session we got in: the first close after the pitch. */
  entryDate: string | null;
  exitDate: string | null;
  horizonDays: number;
  /** The stock's own close-to-close change, before costs, no benchmark. */
  rawReturn: number | null;
  excessReturn: number | null;
}

export interface Performers {
  basis: string;
  ranked: number;
  best: Performer[];
  worst: Performer[];
}

// ─── Judgment: is the rating telling us anything? (backend: lib/pitch-lab/judgment.js) ──

export interface JudgmentGroup {
  n: number;
  meanExcess: number | null;
  medianExcess: number | null;
  hitRate: number | null;
  ratingMin: number | null;
  ratingMax: number | null;
}

export type JudgmentLabel = "too_early" | "working_both_ways" | "working_one_way" | "no_signal" | "backwards";

export interface JudgmentBlock {
  graded: number;
  independentWeeks: number;
  enoughEvidence: boolean;
  /** The median rating: pitches above it are "higher-rated", below it "lower-rated", at it "middle". */
  cutoff: number | null;
  higher: JudgmentGroup;
  middle: JudgmentGroup;
  lower: JudgmentGroup;
  /** Higher-rated mean excess minus lower-rated mean excess (decimal, 0.02 = 2 points). */
  spread: number | null;
  rho: number | null;
  verdict: { label: JudgmentLabel; lean: "right" | "wrong" | "flat" | null; headline: string; detail: string };
}

export type JudgmentLensId = "conviction" | "convictionLegacy" | "mandateScore";

export interface JudgmentLens {
  id: JudgmentLensId;
  label: string;
  unit: string;
  horizons: Record<string, JudgmentBlock>;
}

export interface Judgment {
  version: string;
  evidenceBar: { minGraded: number; minWeeks: number };
  lenses: Record<JudgmentLensId, JudgmentLens>;
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
  /** Absent on snapshots published before the 2026-11-14 backend; the page says so rather than guessing. */
  performers?: Performers;
  /** Absent on snapshots published before the judgment backend; the page says so rather than guessing. */
  judgment?: Judgment;
}

/** Top-level snapshot fields this page reads; the cross-repo test pins them to the backend. */
export const SNAPSHOT_FIELDS = [
  "benchmark", "convictionScale", "days", "evidenceBar", "generatedAt", "horizons", "latest",
  "judgment", "performers", "program", "recent", "schedule", "schemaVersion", "scoreboard",
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
  /** Did the Mandate Score go with beating SPY? Absent on index rows published before 2026-11-14. */
  mandateScoreVerdict?: string | null;
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

/**
 * The next Mandate Review, never a time already past. Reviews are weekly, so a snapshot
 * published before the last review ran is rolled forward a week at a time.
 */
export function upcomingReviewAt(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  let at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const WEEK_MS = 7 * 86_400_000;
  while (at <= now.getTime()) at += WEEK_MS;
  return new Date(at).toISOString();
}

/** "Saturday, November 14, 2026" — the review's day in New York. */
export function fmtLongDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
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

/** "2026-11-14" → "Week of Nov 14, 2026" (weekly reviews); legacy "2026-11" → "November 2026" (monthly reviews) */
export function periodLabel(period: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period ?? "")) return `Week of ${fmtDate(period)}`;
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

/** Plain-words verdict shown at a glance, with the colour it takes (never a colour for "too early"). */
export const JUDGMENT_TONE: Record<JudgmentLabel, "pos" | "neg" | "warn" | "muted"> = {
  working_both_ways: "pos",
  working_one_way: "warn",
  no_signal: "muted",
  backwards: "neg",
  too_early: "muted",
};

const LENS_ORDER: JudgmentLensId[] = ["conviction", "convictionLegacy", "mandateScore"];

function gradedAnywhere(lens: JudgmentLens | undefined): number {
  return Math.max(0, ...Object.values(lens?.horizons ?? {}).map((b) => b.graded));
}

/** Lenses that have any graded pitch, in display order; if none do, all of them (the page shows "too early"). */
export function judgmentLenses(judgment: Judgment | undefined): JudgmentLens[] {
  if (!judgment) return [];
  const all = LENS_ORDER.map((id) => judgment.lenses[id]).filter(Boolean);
  const withData = all.filter((lens) => gradedAnywhere(lens) > 0);
  return withData.length ? withData : all;
}

/**
 * The lens to open on: the one with the most graded pitches, because that is the one
 * with the most to say today. (The new 1-10 conviction scale takes over automatically
 * as its pitches mature.)
 */
export function defaultLens(judgment: Judgment | undefined): JudgmentLensId | null {
  const lenses = judgmentLenses(judgment);
  if (!lenses.length) return null;
  return [...lenses].sort((a, b) => gradedAnywhere(b) - gradedAnywhere(a))[0].id;
}

/** The holding period to open on: the longest one that clears the graded-pitch bar, else the one with most graded. */
export function defaultHorizon(lens: JudgmentLens | undefined, minGraded: number): number | null {
  const entries = Object.entries(lens?.horizons ?? {}).map(([h, b]) => ({ h: Number(h), graded: b.graded })).sort((a, b) => a.h - b.h);
  if (!entries.length) return null;
  const cleared = entries.filter((e) => e.graded >= minGraded);
  if (cleared.length) return cleared[cleared.length - 1].h;
  return [...entries].sort((a, b) => b.graded - a.graded || a.h - b.h)[0].h;
}

/** Mandate Review verdicts in plain words. */
export function verdictLabel(v: string | null | undefined): string {
  if (v === "positive") return "Positive";
  if (v === "negative") return "Negative";
  if (v === "inconclusive") return "Inconclusive";
  if (v === "insufficient_data") return "Insufficient data";
  return v ?? "—";
}

export const REVIEW_STATUS_LABEL: Record<MandateReview["status"], string> = {
  insufficient_data: "Not enough data yet",
  has_suggestions: "Suggestions available",
  no_suggestions: "No significant findings",
};
