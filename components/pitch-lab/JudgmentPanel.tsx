"use client";

import { useState } from "react";
import { Footnote, Hatch, Panel, PanelHead, Status } from "@/components/chrome";
import {
  JUDGMENT_TONE, defaultHorizon, defaultLens, fmtDate, judgmentLenses, pct,
  type JudgmentBlock, type JudgmentGroup, type JudgmentLens, type JudgmentLensId, type PitchLabSnapshot,
} from "@/lib/pitch-lab";

const MIN_SCALE = 0.02; // bars never fill the track on a tiny difference: ±2% is the floor of the axis

function ratingRange(g: JudgmentGroup, unit: string): string {
  if (g.ratingMin == null || g.ratingMax == null) return "";
  const lo = Number.isInteger(g.ratingMin) ? g.ratingMin : g.ratingMin.toFixed(1);
  const hi = Number.isInteger(g.ratingMax) ? g.ratingMax : g.ratingMax.toFixed(1);
  return lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
}

/** One group's average result as a bar that grows right (beat the benchmark) or left (lagged it) from a centre line. */
function GroupRow({ title, group, unit, scale, benchmark, expect }: { title: string; group: JudgmentGroup; unit: string; scale: number; benchmark: string; expect: "right" | "left" }) {
  const mean = group.meanExcess;
  const width = mean == null ? 0 : Math.min(50, (Math.abs(mean) / scale) * 50);
  const color = mean == null ? "var(--disabled)" : mean > 0 ? "var(--pos)" : mean < 0 ? "var(--neg)" : "var(--muted)";
  // The bar is "as hoped" when the higher-rated group points right or the lower-rated group points left.
  const asHoped = mean != null && mean !== 0 && (expect === "right" ? mean > 0 : mean < 0);
  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(150px, 1.1fr) 3fr minmax(150px, 1fr)" }}>
      <div>
        <div className="font-medium" style={{ color: "var(--ink)" }}>{title}</div>
        <div className="pm-label">
          {group.n} pitch{group.n === 1 ? "" : "es"}
          {group.ratingMin != null ? ` · rated ${ratingRange(group, unit)}` : ""}
        </div>
      </div>
      <div className="relative" style={{ height: 22, background: "var(--panel-alt)", border: "1px solid var(--rule)" }} role="img" aria-label={`${title}: average ${pct(mean, { signed: true })} vs ${benchmark}`}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--muted)" }} />
        {mean != null && (
          <div
            style={{
              position: "absolute",
              top: 3,
              bottom: 3,
              background: color,
              opacity: asHoped ? 1 : 0.55,
              width: `${width}%`,
              ...(mean >= 0 ? { left: "50%" } : { right: "50%" }),
            }}
          />
        )}
      </div>
      <div className="pm-num-cell text-right">
        {mean == null ? (
          <span style={{ color: "var(--disabled)" }}>—</span>
        ) : (
          <Status tone={mean > 0 ? "pos" : mean < 0 ? "neg" : "muted"}>{pct(mean, { signed: true })}</Status>
        )}
        <span className="pm-label ml-2">{group.hitRate == null ? "" : `${pct(group.hitRate, { places: 0 })} beat ${benchmark}`}</span>
      </div>
    </div>
  );
}

function EvidenceBar({ label, have, need }: { label: string; have: number; need: number }) {
  const share = Math.min(1, need ? have / need : 0);
  return (
    <div className="flex items-center gap-3">
      <span className="pm-label" style={{ minWidth: 150 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: "var(--panel-alt)", border: "1px solid var(--rule)" }}>
        <div style={{ width: `${share * 100}%`, height: "100%", background: share >= 1 ? "var(--pos)" : "var(--accent)" }} />
      </div>
      <span className="pm-num" style={{ minWidth: 70, textAlign: "right", color: share >= 1 ? "var(--pos)" : "var(--ink-2)" }}>{have} / {need}</span>
    </div>
  );
}

function Tabs<T extends string | number>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          onClick={() => onChange(o.id)}
          className="pm-label"
          style={{
            padding: "3px 10px",
            border: "1px solid var(--rule)",
            background: o.id === value ? "var(--accent)" : "var(--panel)",
            color: o.id === value ? "#fff" : "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Body({ lens, block, snapshot }: { lens: JudgmentLens; block: JudgmentBlock; snapshot: PitchLabSnapshot }) {
  const bar = snapshot.judgment!.evidenceBar;
  const tone = JUDGMENT_TONE[block.verdict.label];
  const scale = Math.max(MIN_SCALE, Math.abs(block.higher.meanExcess ?? 0), Math.abs(block.lower.meanExcess ?? 0));
  const early = block.verdict.label === "too_early";
  const compared = block.higher.n && block.lower.n;
  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="pm-label">Is the rating telling us anything?</div>
        <div className="mt-1" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15, color: early ? "var(--ink)" : tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : tone === "warn" ? "var(--warn)" : "var(--ink)" }}>
          {block.verdict.headline}
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{block.verdict.detail}</p>
      </div>

      {compared ? (
        <div className="space-y-2">
          <GroupRow title="Rated higher" group={block.higher} unit={lens.unit} scale={scale} benchmark={snapshot.benchmark} expect="right" />
          <GroupRow title="Rated lower" group={block.lower} unit={lens.unit} scale={scale} benchmark={snapshot.benchmark} expect="left" />
          <div className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(150px, 1.1fr) 3fr minmax(150px, 1fr)" }}>
            <span />
            <div className="pm-label flex justify-between"><span>← lagged {snapshot.benchmark}</span><span>beat {snapshot.benchmark} →</span></div>
            <span />
          </div>
          <p className="pm-label">
            Working both ways means the top bar points right and the bottom bar points left.
            {block.middle.n ? ` ${block.middle.n} pitch${block.middle.n === 1 ? "" : "es"} sit exactly at the middle rating (${ratingRange(block.middle, lens.unit)}) and are left out of the comparison.` : ""}
          </p>
        </div>
      ) : (
        <Hatch title="Nothing to compare yet" note="This needs graded pitches with at least two different ratings." />
      )}

      <div className="space-y-2">
        <EvidenceBar label="Graded pitches" have={block.graded} need={bar.minGraded} />
        <EvidenceBar label="Independent weeks" have={block.independentWeeks} need={bar.minWeeks} />
      </div>
    </div>
  );
}

export function JudgmentPanel({ snapshot }: { snapshot: PitchLabSnapshot }) {
  const judgment = snapshot.judgment;
  const lenses = judgmentLenses(judgment);
  const [lensId, setLensId] = useState<JudgmentLensId | null>(() => defaultLens(judgment));
  const [horizon, setHorizon] = useState<number | null>(null);

  if (!judgment || !lenses.length) {
    return (
      <Panel>
        <div className="p-6">
          <Hatch title="Is the rating working?" note="Appears after the next snapshot from the updated backend." />
        </div>
      </Panel>
    );
  }

  const lens = lenses.find((l) => l.id === lensId) ?? lenses[0];
  const horizons = Object.keys(lens.horizons).map(Number).sort((a, b) => a - b);
  const activeHorizon = horizon != null && horizons.includes(horizon) ? horizon : defaultHorizon(lens, judgment.evidenceBar.minGraded) ?? horizons[0];
  const block = lens.horizons[String(activeHorizon)];
  const overall = snapshot.scoreboard?.[String(activeHorizon)];

  return (
    <Panel>
      <PanelHead
        title="Is the rating working?"
        caption={`Higher-rated vs lower-rated pitches, results after ${activeHorizon} trading days, vs ${snapshot.benchmark}`}
        right={
          <div className="flex flex-wrap items-center gap-3">
            {lenses.length > 1 && (
              <Tabs label="Rating" value={lens.id} onChange={(id) => setLensId(id)} options={lenses.map((l) => ({ id: l.id, label: l.label.replace(" (original 1-5 scale)", " (old 1–5)") }))} />
            )}
            <Tabs label="Holding period" value={activeHorizon} onChange={setHorizon} options={horizons.map((h) => ({ id: h, label: `${h}d` }))} />
          </div>
        }
      />
      {block ? <Body lens={lens} block={block} snapshot={snapshot} /> : null}
      <div className="px-5 pb-4">
        <Footnote label="How to read this">
          Each rating splits the graded pitches at its middle value: &quot;higher&quot; is above it, &quot;lower&quot; is below it. Each bar is that
          group&apos;s average result against {snapshot.benchmark}, after costs. A verdict is withheld until the evidence bar is met
          ({judgment.evidenceBar.minGraded} graded pitches across {judgment.evidenceBar.minWeeks} independent weeks), because a few lucky or
          unlucky weeks can look like skill. Ratings on different scales are never mixed.
          {overall?.graded
            ? ` For reference, all ${overall.graded} graded pitches together averaged ${pct(overall.meanExcess, { signed: true })} vs ${snapshot.benchmark} at ${activeHorizon} days (${pct(overall.hitRate, { places: 0 })} beat it); that blends strong and weak ratings, so it does not say whether the judgment works.`
            : ""}
          {snapshot.generatedAt ? ` As of ${fmtDate(snapshot.generatedAt)}.` : ""}
        </Footnote>
      </div>
    </Panel>
  );
}
