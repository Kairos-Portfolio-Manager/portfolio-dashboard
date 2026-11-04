import type { MandateScore, ScoreCategory } from "@/lib/pitch-lab";
import { Nil, Status } from "@/components/chrome";
import { score10 } from "@/lib/pitch-lab";

const STATUS_REASON: Record<string, string> = {
  missing_value: "No value for this company",
  thin_peers: "Too few peers to rank",
  no_peers: "No industry peers",
  peer_data_unavailable: "Peer data was down",
  no_peer_data: "Recorded without peer data",
  not_recorded: "Not recorded",
};

/**
 * The 10 points as one bar: each category's width is its share of the 10, filled
 * by points earned (ink), points that could be scored but were not earned (grey),
 * and points that could not be scored at all (light). Missing never looks like zero.
 */
export function ScoreBar({ categories, height = 8 }: { categories: ScoreCategory[]; height?: number }) {
  return (
    <div className="flex w-full gap-px" style={{ height }} aria-hidden>
      {categories.map((c) => {
        const earned = c.max ? (c.earned / c.max) * 100 : 0;
        const missed = c.max ? ((c.scorable - c.earned) / c.max) * 100 : 0;
        return (
          <div key={c.id} className="flex h-full" style={{ width: `${c.max * 10}%`, background: "var(--rule-soft)" }} title={`${c.id}: ${c.earned} of ${c.scorable} scorable (${c.max} max)`}>
            <div style={{ width: `${earned}%`, background: "var(--accent)" }} />
            <div style={{ width: `${missed}%`, background: "var(--chip-2)" }} />
          </div>
        );
      })}
    </div>
  );
}

export function ScoreFigure({ score, metricsScored, metricsTotal }: { score: number | null; metricsScored: number; metricsTotal: number }) {
  if (score == null) return <Nil />;
  return (
    <span className="pm-num">
      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{score10(score)}</span>
      <span style={{ color: "var(--muted)" }}>/10</span>
      <span className="ml-1.5" style={{ color: "var(--muted-2)" }}>
        {metricsScored}/{metricsTotal}
      </span>
    </span>
  );
}

const pts = (v: number) => (Number.isInteger(v * 10) ? v.toFixed(1) : v.toFixed(2));

/** Every metric: percentile among industry peers → mandate band → points, or why it was not scored. */
export function ScoreBreakdown({ score }: { score: MandateScore }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs" style={{ color: "var(--ink-2)" }}>
        <span>
          <span className="pm-label mr-2">Mandate Score</span>
          <ScoreFigure score={score.score} metricsScored={score.metricsScored} metricsTotal={score.metricsTotal} />
        </span>
        <span>
          {pts(score.earned)} points earned of {pts(score.scorable)} that could be scored
          {score.scorable < 10 ? ` (${pts(10 - score.scorable)} could not be scored and are left out, not counted as zero)` : ""}
        </span>
        {score.source === "derived" && <span style={{ color: "var(--muted)" }}>Derived from the ranks stored on this pitch</span>}
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--rule)" }}>
            <th className="py-1 text-left pm-label">Category / metric</th>
            <th className="py-1 text-right pm-label">vs industry peers</th>
            <th className="py-1 text-left pl-4 pm-label">Mandate band</th>
            <th className="py-1 text-right pm-label">Points</th>
          </tr>
        </thead>
        <tbody>
          {score.categories.map((c) => (
            <CategoryRows key={c.id} category={c} score={score} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryRows({ category: c, score }: { category: ScoreCategory; score: MandateScore }) {
  const metrics = score.metrics.filter((m) => m.category === c.id);
  return (
    <>
      <tr style={{ borderBottom: "1px solid var(--rule-row)", background: "var(--panel-alt)" }}>
        <td className="py-1.5 font-medium" style={{ color: "var(--ink)" }}>
          {c.id} · {c.label}
        </td>
        <td />
        <td className="pl-4">
          <div className="flex" style={{ width: 120, height: 6, background: "var(--rule-soft)" }} aria-hidden>
            <div style={{ width: `${c.max ? (c.earned / c.max) * 100 : 0}%`, background: "var(--accent)" }} />
            <div style={{ width: `${c.max ? ((c.scorable - c.earned) / c.max) * 100 : 0}%`, background: "var(--chip-2)" }} />
          </div>
        </td>
        <td className="py-1.5 text-right pm-num" style={{ color: "var(--ink)" }}>
          {c.scorable ? pts(c.earned) : "—"} <span style={{ color: "var(--muted)" }}>/ {pts(c.max)}</span>
        </td>
      </tr>
      {metrics.map((m) => (
        <tr key={m.id} style={{ borderBottom: "1px solid var(--rule-row)" }}>
          <td className="py-1 pl-4" style={{ color: "var(--ink-2)" }}>
            {m.label}
          </td>
          <td className="py-1 text-right pm-num">
            {m.percentile == null ? <Nil /> : `${Math.round(m.percentile * 100)}th pct of ${m.peerCount}`}
          </td>
          <td className="py-1 pl-4">
            {m.band ? (
              <Status tone={m.points ? "pos" : "muted"}>{m.band}</Status>
            ) : (
              <span style={{ color: "var(--muted)" }}>{STATUS_REASON[m.status] ?? m.status}</span>
            )}
          </td>
          <td className="py-1 text-right pm-num">
            {m.points == null ? <Nil /> : pts(m.points)} <span style={{ color: "var(--muted)" }}>/ {pts(m.maxPoints)}</span>
          </td>
        </tr>
      ))}
    </>
  );
}
