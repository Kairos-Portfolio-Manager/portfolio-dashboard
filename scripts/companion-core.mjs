/**
 * Pure logic for the Mac trade executor (mac-companion.mjs) — extracted so the
 * money-critical decisions have test coverage (tests/companion-core.test.ts).
 * No I/O, no env reads at module level, no side effects.
 */

import { timingSafeEqual } from "node:crypto";
// The signature payload + HMAC now live single-source in the shared contract
// (../lib/contracts/signature.js). tests/companion-core.test.ts still cross-checks
// that this, the dashboard, and the backend all agree.
import { computeDecisionSignature } from "../lib/contracts/signature.js";
import { checkSellOwnerShareLimitForExecution } from "../lib/contracts/proposal.js";
export { computeDecisionSignature };

// ── Scheduled-read retry backoff ───────────────────────────────────────────
// A failed MCP read stays queued and is retried when its lease lapses. A
// persistent failure (expired CLI login) must not retry — and write receipt
// history to Redis — every 5 minutes forever: 1st failure waits the base
// lease, then it doubles per consecutive failure up to the cap.
export function mcpReadRetryLeaseSeconds(consecutiveFailures, baseSeconds = 300, maxSeconds = 3600) {
  const n = Math.max(1, Math.floor(Number(consecutiveFailures) || 1));
  return Math.min(baseSeconds * 2 ** Math.min(n - 1, 10), maxSeconds);
}

// ── Process role isolation ─────────────────────────────────────────────────
// Keep scheduled broker reads and signed trade execution separable so an
// always-on read worker cannot accidentally gain execution authority.
export function resolveCompanionRole(value = "full") {
  const name = String(value ?? "").trim().toLowerCase() || "full";
  const roles = {
    full: {
      name: "full",
      brokerReads: true,
      execution: true,
      marketScans: true,
      heartbeatKey: "pm:companion:last-seen",
    },
    "read-worker": {
      name: "read-worker",
      brokerReads: true,
      execution: false,
      marketScans: false,
      heartbeatKey: "pm:broker-reader:last-seen",
    },
    execution: {
      name: "execution",
      brokerReads: false,
      execution: true,
      marketScans: true,
      heartbeatKey: "pm:companion:last-seen",
    },
  };
  const role = roles[name];
  if (!role) {
    throw new Error(`Invalid COMPANION_ROLE "${name}". Expected full, read-worker, or execution.`);
  }
  return Object.freeze(role);
}

export function verifyApprovalSignature(proposal, secret) {
  if (!secret) {
    return { ok: false, reason: "AUDIT_HMAC_SECRET is not configured on this machine — cannot verify approvals" };
  }
  if (!proposal.decisionHmac) {
    return { ok: false, reason: "proposal has no decision signature (not approved through the dashboard)" };
  }
  const expected = Buffer.from(computeDecisionSignature(proposal, secret), "hex");
  const provided = Buffer.from(String(proposal.decisionHmac), "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "decision signature is INVALID (fields modified after approval, or forged)" };
  }
  return { ok: true };
}

/**
 * A versioned SELL is executable only when its strategy-owned share ceiling is
 * present and signed. Legacy non-SELLs remain compatible, but legacy SELLs
 * fail closed rather than falling back to the account-wide ticker position.
 */
export function verifySellOwnerShareCeiling(proposal) {
  return checkSellOwnerShareLimitForExecution(proposal);
}

/** Refuse fulfillment/accounting when the broker reports more than authorized. */
export function verifySellFillWithinOwnerShareCeiling(proposal, shares) {
  const scope = verifySellOwnerShareCeiling(proposal);
  if (!scope.ok) return scope;
  if (String(proposal?.side ?? "").toUpperCase() !== "SELL") {
    return { ok: true, legacy: scope.legacy };
  }
  const filledShares = Number(shares);
  if (!Number.isFinite(filledShares) || filledShares <= 0) {
    return { ok: false, legacy: false, reason: "SELL fill has invalid share quantity" };
  }
  if (filledShares > proposal.sellOwnerShareLimit + 1e-8) {
    return {
      ok: false,
      legacy: false,
      reason: `SELL fill ${filledShares} shares exceeds signed strategy-owner ceiling ${proposal.sellOwnerShareLimit}`,
    };
  }
  return { ok: true, legacy: false };
}

// ── Order instructions ─────────────────────────────────────────────────────
// SELL must never inherit BUY math or BUY wording (the prompt used to say
// "buy $X notional" for SELL proposals on a live account).
/**
 * @param {{ ticker: string, side: string, amountDollars: number, maxPrice: number | null, proposalContractVersion?: number | null, sellOwnerShareLimit?: number | null }} proposal
 */
export function buildOrderInstructions({
  ticker,
  side,
  amountDollars,
  maxPrice,
  proposalContractVersion = null,
  sellOwnerShareLimit = null,
}) {
  const isSell = String(side).toUpperCase() === "SELL";
  if (isSell) {
    const scope = verifySellOwnerShareCeiling({
      side,
      proposalContractVersion,
      sellOwnerShareLimit,
    });
    if (!scope.ok) throw new Error(`SELL proposal is not executable: ${scope.reason}.`);
    return `MARKET ORDER — sell up to $${amountDollars} notional of ${ticker}, with a hard strategy-owner ceiling of ${sellOwnerShareLimit} shares.
First check the current quote. If $${amountDollars} would require more than ${sellOwnerShareLimit} shares, submit exactly ${sellOwnerShareLimit} shares instead. Never use the account-wide ${ticker} position as the ceiling, never sell more than ${sellOwnerShareLimit} shares, and place NO order if that share quantity is unavailable.`;
  }
  const wholeShares = maxPrice ? Math.floor(amountDollars / maxPrice) : 0;
  const useLimit = Boolean(maxPrice) && wholeShares >= 1;
  return useLimit
    ? `LIMIT ORDER — buy ${wholeShares} whole shares of ${ticker} at limit price $${maxPrice}. Use whole share quantity, NOT dollar amount.`
    : `MARKET ORDER — buy $${amountDollars} notional of ${ticker} using dollar-amount fractional sizing.`;
}

// ── Reconcile decision table ───────────────────────────────────────────────
// A proposal stuck in executionState "Executing" means an order attempt started
// but its outcome was never confirmed. Given the broker's answer, decide what
// to do — NEVER blindly re-execute.
//   rec = { found: boolean, orderId?, state?, shares?, price? }
// Returns one of:
//   { action: "record",  orderId, shares, price }  — order filled; record + fulfill
//   { action: "fail", reason }                     — terminal failure; require fresh signed approval
//   { action: "wait" }                             — order still working; check again next poll
export function decideReconcileAction(rec) {
  if (!rec.found) {
    return {
      action: "fail",
      reason: "no broker order found after an execution attempt; approval is stale and must not be retried automatically",
    };
  }
  const state = String(rec.state ?? "").toLowerCase();
  if (state === "filled") {
    return { action: "record", orderId: rec.orderId, shares: rec.shares, price: rec.price };
  }
  if (["cancelled", "rejected", "failed", "voided"].includes(state)) {
    return { action: "fail", reason: `broker order ${rec.orderId} ended ${state}` };
  }
  return { action: "wait" };
}

// ── Execution result sanity ────────────────────────────────────────────────
// The executor parses the model's JSON out of `claude -p` stdout — a
// hallucinated result must not reach the ledger. Robinhood order IDs are
// UUIDs; anything else is treated as fabricated.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isPlausibleOrderId(orderId) {
  return typeof orderId === "string" && UUID_RE.test(orderId.trim());
}

// ── Market hours ───────────────────────────────────────────────────────────
// Full-closure NYSE holidays. Early-close (1:00 PM) days are intentionally not
// modeled — morning execution on those days is legitimate, and afternoon
// orders are rejected by the broker anyway. EXTEND THIS LIST each December.
export const MARKET_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed — Jul 4 is a Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // Martin Luther King Jr. Day
  "2027-02-15", // Washington's Birthday
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed — Jun 19 is a Saturday)
  "2027-07-05", // Independence Day (observed — Jul 4 is a Sunday)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving
  "2027-12-24", // Christmas (observed — Dec 25 is a Saturday)
]);

export function easternClock(now = new Date()) {
  return easternParts(now);
}

function easternParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    weekday: byType.weekday,
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
  };
}

export function isMarketOpen(now = new Date(), holidays = MARKET_HOLIDAYS) {
  const { date, weekday, minutes } = easternParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  if (holidays.has(date)) return false;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60; // 9:30–16:00 ET
}
