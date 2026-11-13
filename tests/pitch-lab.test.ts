import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  REVIEW_HISTORY_SCHEMA_VERSION, REVIEW_ID_RE, REVIEW_INDEX_KEY, REVIEW_KEY_PREFIX, SNAPSHOT_FIELDS, SNAPSHOT_KEY, SNAPSHOT_SCHEMA_VERSION,
  beatTiles, fmtET, fmtLongDate, periodLabel, upcomingReviewAt, reviewIndexFrom, snapshotFromEnvelope, timeUntil,
  type LatestPitch, type MandateReview, type Performer, type PitchLabSnapshot, type RecentPitch, type ReviewIndexEntry, type ScoreMetric,
} from "../lib/pitch-lab";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, "../../portfolio-manager");

async function backendModule(relativePath: string) {
  const path = join(backendRoot, relativePath);
  assert.ok(existsSync(path), `Expected Portfolio Manager sibling module at ${path}`);
  return import(pathToFileURL(path).href);
}

const ranked = (percentile: number) => ({ status: "ranked", percentile, peerCount: 12 });

async function backendSnapshot(): Promise<PitchLabSnapshot> {
  const { buildPitchLabSnapshot } = await backendModule("lib/pitch-lab/dashboard-snapshot.js");
  const pitch = {
    id: "pitch_a", ticker: "NET", conviction: 8, convictionScale: 10, pitchedAt: "2026-11-02T22:44:00.000Z",
    rationale: { thesis: "Revenue growth is re-accelerating while the multiple sits below peers.", risks: ["Guidance could disappoint."] },
    peers: { ranks: { revGrowth: ranked(0.95), epsTrajectory: ranked(0.2) } },
  };
  const outcome = { pitchId: "pitch_a", horizonDays: 5, excessReturn: 0.03, grossReturn: 0.042, gradedAt: "2026-11-10T22:45:00.000Z", entryDate: "2026-11-03", exitDate: "2026-11-10" };
  return buildPitchLabSnapshot({ pitches: [pitch], outcomes: [outcome], now: new Date("2026-11-04T15:00:00Z") });
}

const keys = (value: object) => Object.keys(value).sort();

// ─── Cross-repo shape ────────────────────────────────────────────────────────

test("the backend snapshot has exactly the fields this site reads, at the version it expects", async () => {
  const snapshot = await backendSnapshot();
  const backend = await backendModule("lib/pitch-lab/dashboard-snapshot.js");
  const publisher = await backendModule("lib/pitch-lab-snapshot-publisher.js");
  assert.equal(backend.SNAPSHOT_SCHEMA_VERSION, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(publisher.PITCH_LAB_SNAPSHOT_KEY, SNAPSHOT_KEY);
  assert.deepEqual(keys(snapshot), [...SNAPSHOT_FIELDS].sort());

  // Typed samples: TypeScript rejects a missing or extra field, the assertion ties the set to the backend.
  const latestSample: LatestPitch = { ticker: "", conviction: 0, convictionScale: 10, thesis: "", risk: "", mandateScore: snapshot.latest.pitches[0].mandateScore };
  assert.deepEqual(keys(snapshot.latest.pitches[0]), keys(latestSample));
  const metricSample: ScoreMetric = { id: "", label: "", category: "", status: "", percentile: null, peerCount: 0, band: null, points: null, maxPoints: 0 };
  assert.deepEqual(keys(snapshot.latest.pitches[0].mandateScore.metrics[0]), keys(metricSample));
  const recentSample: RecentPitch = { ticker: "", date: "", conviction: 0, convictionScale: 10, mandateScore: null, metricsScored: 0, metricsTotal: 9, categories: [], excessReturn: {} };
  assert.deepEqual(keys(snapshot.recent[0]), keys(recentSample));
  const performerSample: Performer = { ticker: "", pitchDate: "", entryDate: null, exitDate: null, horizonDays: 0, rawReturn: null, excessReturn: null };
  assert.deepEqual(keys(snapshot.performers!.best[0]), keys(performerSample));
});

test("the best/worst lists carry the raw return and the day we got in", async () => {
  const { performers } = await backendSnapshot();
  assert.ok(performers);
  assert.deepEqual(performers.best.map((r) => [r.ticker, r.rawReturn, r.entryDate, r.horizonDays]), [["NET", 0.042, "2026-11-03", 5]]);
  assert.deepEqual(performers.worst, [], "one pitch is never listed as both best and worst");
});

test("the parsed snapshot carries the score, the breakdown, and the next review time", async () => {
  const snapshot = snapshotFromEnvelope(JSON.stringify({ publishedAt: "2026-11-04T15:00:00Z", snapshot: await backendSnapshot() }));
  assert.ok(snapshot);
  const [pitch] = snapshot.latest.pitches;
  assert.equal(pitch.mandateScore.score, 4.5);
  assert.equal(pitch.mandateScore.metrics.find((m) => m.id === "revGrowth")?.band, "top 10%");
  assert.equal(snapshot.schedule.nextMandateReviewAt, "2026-11-07T16:00:00.000Z");
  assert.deepEqual(snapshot.recent[0].excessReturn, { 5: 0.03, 10: null, 20: null });
  assert.deepEqual(beatTiles(snapshot).map((t) => [t.horizonDays, t.beat, t.graded]), [[5, 1, 1], [10, 0, 0], [20, 0, 0]]);
  assert.equal(snapshotFromEnvelope({ snapshot: { ...snapshot, schemaVersion: "pitch-lab.snapshot.v1" } }), null, "an older snapshot is not misread");
  assert.equal(snapshotFromEnvelope(null), null);
});

test("review history: backend keys, ids and index rows match what the site reads", async () => {
  const publisher = await backendModule("lib/pitch-lab-review-publisher.js");
  assert.equal(publisher.PITCH_LAB_REVIEW_INDEX_KEY, REVIEW_INDEX_KEY);
  assert.equal(publisher.PITCH_LAB_REVIEW_KEY_PREFIX, REVIEW_KEY_PREFIX);
  assert.equal(publisher.REVIEW_HISTORY_SCHEMA_VERSION, REVIEW_HISTORY_SCHEMA_VERSION);

  const writes: [string, string][] = [];
  const redis = { set: async (key: string, value: string) => { writes.push([key, value]); return "OK"; } };
  const review = {
    id: "mr_0123456789abcdef0123", schemaVersion: "pitch-lab.mandate-review.v1", agentId: "agent-1", period: "2026-11",
    generatedAt: "2026-11-07T16:00:05.000Z", status: "insufficient_data", metrics: [],
    insufficientData: { gradedPitches: 14, independentWeeks: 3, moreNeeded: { pitches: 16, weeks: 5 } },
  };
  assert.match(review.id, REVIEW_ID_RE);
  await publisher.publishMandateReviewHistory([review], { redis });
  const index = reviewIndexFrom(writes.at(-1)?.[1]);
  assert.ok(index);
  const sample: ReviewIndexEntry = { id: "", period: "", generatedAt: "", status: "no_suggestions", gradedPitches: null, independentWeeks: null, recommended: 0, watch: 0, mandateScoreVerdict: null };
  assert.deepEqual(keys(index.reviews[0]), keys(sample));
  assert.equal(index.reviews[0].gradedPitches, 14);
  assert.equal(writes[0][0], `${REVIEW_KEY_PREFIX}${review.id}`);
  assert.equal(reviewIndexFrom(null), null, "no index yet → empty review page");
});

test("a generated review has the sections the review page renders", async () => {
  const { generateMandateReview, REQUIRED_REPORT_SCHEMA } = await backendModule("lib/pitch-lab/mandate-review.js");
  const { AGENT_SCORING } = await backendModule("config/scoring/mandate-v2.js");
  const report = { schemaVersion: REQUIRED_REPORT_SCHEMA, options: { minSample: 30, minClusters: 8 }, periods: [{ id: "all", horizons: [{ horizonDays: 5, graded: 3, clusters: 1 }] }] };
  const review: MandateReview = generateMandateReview(report, AGENT_SCORING["agent-1"], { now: new Date("2026-11-07T16:00:00Z") });
  assert.equal(review.status, "insufficient_data");
  assert.equal(review.period, "2026-11-07", "weekly reviews are named by their Saturday");
  assert.ok("mandateScore" in review && "conviction" in review && Array.isArray(review.caveats));
});

// ─── Formatting ──────────────────────────────────────────────────────────────

test("review times read in New York time with a plain countdown", () => {
  assert.equal(fmtET("2026-11-07T16:00:00.000Z"), "Sat, Nov 7 · 11:00 AM ET");
  assert.equal(timeUntil("2026-11-07T16:00:00.000Z", new Date("2026-11-04T15:00:00Z")), "in 3 days");
  assert.equal(timeUntil("2026-11-04T20:00:00.000Z", new Date("2026-11-04T15:00:00Z")), "in 5 hours");
  assert.equal(timeUntil("2026-11-04T15:20:00.000Z", new Date("2026-11-04T15:00:00Z")), "in 20 minutes");
  assert.equal(timeUntil("2026-11-04T14:00:00.000Z", new Date("2026-11-04T15:00:00Z")), "due now");
  assert.equal(periodLabel("2026-11"), "November 2026", "older monthly reviews keep their month");
  assert.equal(periodLabel("2026-11-14"), "Week of Nov 14, 2026");
  assert.equal(fmtLongDate("2026-11-14T16:00:00.000Z"), "Saturday, November 14, 2026");
  assert.equal(upcomingReviewAt("2026-11-14T16:00:00.000Z", new Date("2026-11-13T20:00:00Z")), "2026-11-14T16:00:00.000Z");
  assert.equal(upcomingReviewAt("2026-11-14T16:00:00.000Z", new Date("2026-11-14T17:00:00Z")), "2026-11-21T16:00:00.000Z", "a past review rolls to next Saturday");
  assert.equal(upcomingReviewAt(null), null);
  assert.equal(fmtET(null), "—");
});

// ─── Routes ──────────────────────────────────────────────────────────────────

test("Pitch Lab routes check permissions and only read pitchlab: keys", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const path of ["app/api/pitch-lab/route.ts", "app/api/pitch-lab/reviews/[id]/route.ts"]) {
    const source = read(path);
    assert.match(source, /requireApiPermission/);
    assert.match(source, /permission:\s*"portfolio:full"/);
    assert.match(source, /action:\s*"PITCH_LAB_READ"/);
    assert.doesNotMatch(source, /\.set\(|\.del\(|pm:/, `${path} must stay read-only`);
  }
  assert.match(read("app/api/pitch-lab/reviews/[id]/route.ts"), /REVIEW_ID_RE\.test\(id\)/, "the review id is checked before it becomes a key");
  assert.ok([SNAPSHOT_KEY, REVIEW_INDEX_KEY, REVIEW_KEY_PREFIX].every((key) => key.startsWith("pitchlab:")));
});
