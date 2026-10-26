/**
 * Portfolio Dashboard — Mac Trade Executor Companion
 *
 * Polls Redis every 30s for ApprovedForBrokerReview proposals and executes
 * them via `claude -p` using the Robinhood MCP on this Mac.
 *
 * Run once to set up:
 *   pm2 start scripts/mac-companion.mjs --name portfolio-executor --interpreter node
 *
 * Requires:
 *   - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env or .env
 *   - Claude Code CLI authenticated with claude.ai (unset ANTHROPIC_API_KEY)
 *   - Robinhood MCP added and authorized in Claude Code CLI
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildHoldingsSyncProvenanceArgs } from "../lib/mcp-read-invocation.mjs";
import {
  verifyApprovalSignature,
  verifySellOwnerShareCeiling,
  verifySellFillWithinOwnerShareCeiling,
  buildOrderInstructions,
  decideReconcileAction,
  isPlausibleOrderId,
  isMarketOpen,
  resolveCompanionRole,
  mcpReadRetryLeaseSeconds,
} from "./companion-core.mjs";
import { McpReadJobKindSchema, McpReadRequestSchema } from "../lib/contracts/mcp-read-job.js";
import {
  buildMcpReadReceiptEvidence,
  MCP_JOB_HISTORY_MAX,
  MCP_JOB_HISTORY_TTL_SECONDS,
  resolveMcpReceiptSource,
} from "./mcp-read-receipt.mjs";
import { assertScheduledMcpAccountBinding, extractMcpToolCalls, summarizeMcpStream } from "./mcp-stream-evidence.mjs";
import { execFileWithClosedStdin } from "./claude-cli.mjs";
import { fetchJsonWithTimeout } from "./redis-request.mjs";

const execFileAsync = promisify(execFile);
const REDIS_REQUEST_TIMEOUT_MS = 15_000;

async function runClaude(args, options) {
  // Claude CLI explicitly treats /dev/null as the unattended prompt mode.
  // A pipe that is merely closed can still be interpreted as missing input.
  try {
    return await execFileWithClosedStdin(execFile, CLAUDE_BIN, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // execFile includes every command argument in error.message, which would
    // leak the full trade prompt into logs and Telegram alerts. Claude's own
    // stdout/stderr provides the actionable reason without the prompt.
    const output = [error?.stdout, error?.stderr]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    const code = Number.isInteger(error?.code) ? ` (exit ${error.code})` : "";
    throw new Error(`Claude CLI failed${code}: ${output || "no diagnostic output"}`);
  }
}

// ── Env loading ────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const candidates = [
    join(__dir, "../.env.local"),
    join(__dir, "../.env"),
    join(__dir, "../../portfolio-manager/.env"),
  ];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    const lines = readFileSync(f, "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const PORTFOLIO_BACKEND_URL = process.env.PORTFOLIO_BACKEND_URL?.trim().replace(/\/$/, "");
const PORTFOLIO_WEBHOOK_SECRET = process.env.PORTFOLIO_WEBHOOK_SECRET?.trim();
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 min during market hours
const LOCK_TTL_SECONDS = 300; // 5 min — prevents double-execution if companion restarts mid-trade
const LIST_KEY = "pm:approval_proposals";
const CLAUDE_BIN = process.env.CLAUDE_BIN?.trim()
  || (existsSync("/Users/samhuffard/.local/bin/claude") ? "/Users/samhuffard/.local/bin/claude" : "claude");
const ROBINHOOD_MCP_CONFIG = process.env.ROBINHOOD_MCP_CONFIG?.trim() || join(__dir, "../.mcp.json");
const COMPANION_ROLE = resolveCompanionRole(process.env.COMPANION_ROLE);
const MCP_RECEIPT_HMAC_SECRET = process.env.MCP_RECEIPT_HMAC_SECRET?.trim();
const MCP_READ_RECEIPT_SOURCE = COMPANION_ROLE.brokerReads
  ? resolveMcpReceiptSource(COMPANION_ROLE.name, process.env.MCP_READ_RECEIPT_SOURCE)
  : null;
if (COMPANION_ROLE.brokerReads && !MCP_RECEIPT_HMAC_SECRET) {
  throw new Error("MCP_RECEIPT_HMAC_SECRET is required for the broker read-worker.");
}
const ROBINHOOD_MCP_TOOLS = "mcp__robinhood-trading__*";
const AGENTIC_ACCOUNT_NUMBER = process.env.ROBINHOOD_ACCOUNT_NUMBER?.trim();
// Fixed, non-mutating allowlists for scheduled broker data work. Do not widen
// these to a wildcard: the execution path has separate, signed authority.
const MCP_SNAPSHOT_TOOLS = [
  "mcp__robinhood-trading__get_accounts",
  "mcp__robinhood-trading__get_portfolio",
  "mcp__robinhood-trading__get_equity_positions",
].join(",");
const MCP_RECONCILE_TOOLS = [
  "mcp__robinhood-trading__get_accounts",
  "mcp__robinhood-trading__get_equity_orders",
].join(",");
// Execution is deliberately narrower than the historical wildcard: it may
// inspect accounts solely to bind the order, then place the signed equity order.
const MCP_EXECUTION_TOOLS = [
  "mcp__robinhood-trading__get_accounts",
  "mcp__robinhood-trading__place_equity_order",
].join(",");
const MCP_READ_LEASE_SECONDS = 5 * 60;
const MCP_READ_RECEIPT_TTL_SECONDS = 8 * 24 * 3600;
const ACK_MCP_QUEUE_HEAD_SCRIPT = `
local current = redis.call("LINDEX", KEYS[1], 0)
if current ~= ARGV[1] then return 0 end
redis.call("LPOP", KEYS[1])
return 1
`;
// One EVAL per idle tick (Upstash bills a script as a single command) writes
// the liveness heartbeat and reports, per scheduled read kind, whether a queued
// request exists with no active lease. KEYS = [heartbeat, then (request, queue,
// lease) per kind]; ARGV = [iso timestamp, heartbeat ttl seconds].
const HEARTBEAT_AND_PENDING_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
local pending = {}
for i = 2, #KEYS, 3 do
  local work = redis.call("EXISTS", KEYS[i]) == 1 or redis.call("LLEN", KEYS[i + 1]) > 0
  if work and redis.call("EXISTS", KEYS[i + 2]) == 0 then
    pending[#pending + 1] = 1
  else
    pending[#pending + 1] = 0
  end
end
return pending
`;
const SCHEDULED_MCP_READ_KINDS = ["holdings-sync", "order-reconciliation"];
const mcpReadConsecutiveFailures = new Map();
const MARKET_SYNC_DISALLOWED_TOOLS = [
  "mcp__robinhood-trading__place_equity_order",
  "mcp__robinhood-trading__place_option_order",
  "mcp__robinhood-trading__cancel_equity_order",
  "mcp__robinhood-trading__cancel_option_order",
  "mcp__robinhood-trading__review_equity_order",
  "mcp__robinhood-trading__review_option_order",
  "mcp__robinhood-trading__create_scan",
  "mcp__robinhood-trading__update_scan_filters",
  "mcp__robinhood-trading__update_scan_config",
  "mcp__robinhood-trading__create_watchlist",
  "mcp__robinhood-trading__rename_watchlist",
  "mcp__robinhood-trading__add_to_watchlist",
  "mcp__robinhood-trading__remove_from_watchlist",
].join(",");

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error("[companion] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
  process.exit(1);
}
if (!existsSync(ROBINHOOD_MCP_CONFIG)) {
  throw new Error(`Robinhood MCP configuration is required at ${ROBINHOOD_MCP_CONFIG}.`);
}

// Broker work must not inherit dashboard-project instructions. The companion is
// already restricted by a signed approval, the exact Agentic account, a narrow
// MCP tool allowlist, and a broker ref_id. Loading only the MCP config prevents
// a dashboard UI rule from making this dedicated execution process refuse a
// properly authorized trade.
const BROKER_COMPANION_SYSTEM_PROMPT = `You are the dedicated Portfolio Manager broker companion. Follow the user request exactly, but only use the explicitly allowed Robinhood MCP tools. Do not use shell, files, browsers, or any other tool. A live order is authorized only when the request says it is a signed approval for the configured Agentic account and supplies its exact ref_id. Do not exercise independent investment discretion. Return only the exact JSON object requested.`;

function robinhoodClaudeArgs({ prompt, allowedTools, disallowedTools = null, stream = false }) {
  return [
    "-p",
    "--setting-sources", "user",
    "--strict-mcp-config",
    "--mcp-config", ROBINHOOD_MCP_CONFIG,
    "--system-prompt", BROKER_COMPANION_SYSTEM_PROMPT,
    ...(stream ? ["--verbose", "--output-format", "stream-json", "--include-partial-messages"] : []),
    "--allowedTools", allowedTools,
    ...(disallowedTools ? ["--disallowedTools", disallowedTools] : []),
    "--permission-mode", "bypassPermissions",
    prompt,
  ];
}

// ── Redis helpers ──────────────────────────────────────────────────────────────
async function redisCmd(cmd, ...args) {
  const { response: res, json } = await fetchJsonWithTimeout(fetch, `${REDIS_URL}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  }, REDIS_REQUEST_TIMEOUT_MS);
  if (!res.ok || json.error) throw new Error(`Redis ${cmd} failed: ${json.error ?? `HTTP ${res.status}`}`);
  return json.result;
}

async function redisPost(body) {
  const { response: res, json } = await fetchJsonWithTimeout(fetch, REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, REDIS_REQUEST_TIMEOUT_MS);
  if (!res.ok || json.error) throw new Error(`Redis command failed: ${json.error ?? `HTTP ${res.status}`}`);
  return json.result;
}

function mcpReadRequestKey(kind) {
  return `pm:mcp-read:${McpReadJobKindSchema.parse(kind)}:request`;
}

function mcpReadQueueKey(kind) {
  return `pm:mcp-read:${McpReadJobKindSchema.parse(kind)}:queue`;
}

function mcpReadLeaseKey(kind) {
  return `pm:mcp-read:${McpReadJobKindSchema.parse(kind)}:lease`;
}

function mcpReadReceiptKey(kind) {
  return `pm:mcp-read:${McpReadJobKindSchema.parse(kind)}:last-run`;
}

function safeMcpReadError(error) {
  const raw = String(error?.message ?? error ?? "MCP read failed");
  const beforeCommand = raw.split("Command failed:")[0].trim();
  const summary = beforeCommand || `MCP child process failed${Number.isInteger(error?.code) ? ` with exit ${error.code}` : ""}`;
  const accountRedacted = AGENTIC_ACCOUNT_NUMBER
    ? summary.replaceAll(AGENTIC_ACCOUNT_NUMBER, "[REDACTED_ACCOUNT]")
    : summary;
  return accountRedacted.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)
    || "MCP read failed";
}

async function claimMcpReadRequest(kind) {
  const parsedKind = McpReadJobKindSchema.parse(kind);
  // Drain a pre-FIFO singleton first during the rolling upgrade, then use the
  // invocation queue exclusively. This preserves request order across versions.
  let raw = await redisCmd("get", mcpReadRequestKey(parsedKind));
  let legacy = Boolean(raw);
  if (!raw) raw = await redisCmd("lindex", mcpReadQueueKey(parsedKind), "0");
  if (!raw) return null;
  let request;
  try {
    request = McpReadRequestSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch (error) {
    console.error(`[companion] refusing malformed ${parsedKind} request: ${error.message}`);
    return null;
  }
  const lock = await redisPost(["set", mcpReadLeaseKey(parsedKind), request.id, "NX", "EX", MCP_READ_LEASE_SECONDS]);
  return lock === "OK" ? { request, raw: typeof raw === "string" ? raw : JSON.stringify(raw), legacy } : null;
}

async function recordMcpReadReceipt(claim, { ok, outcome, error = null }) {
  const { request } = claim;
  const { receipt, jobRecord, historyKey } = buildMcpReadReceiptEvidence(request, { ok, outcome, error }, {
    source: MCP_READ_RECEIPT_SOURCE,
    secret: MCP_RECEIPT_HMAC_SECRET,
  });
  await redisPost(["set", mcpReadReceiptKey(request.kind), JSON.stringify(receipt), "EX", MCP_READ_RECEIPT_TTL_SECONDS]);
  await redisPost(["set", `pm:job:${request.kind}:last-run`, JSON.stringify(jobRecord)]);
  await redisPost(["rpush", historyKey, JSON.stringify(jobRecord)]);
  await redisPost(["ltrim", historyKey, -MCP_JOB_HISTORY_MAX, -1]);
  await redisPost(["expire", historyKey, MCP_JOB_HISTORY_TTL_SECONDS]);
  if (ok) {
    if (claim.legacy) {
      await redisCmd("del", mcpReadRequestKey(request.kind));
    } else {
      const acknowledged = await redisPost(["eval", ACK_MCP_QUEUE_HEAD_SCRIPT, "1", mcpReadQueueKey(request.kind), claim.raw]);
      if (Number(acknowledged) !== 1) throw new Error(`MCP ${request.kind} queue head changed before acknowledgement.`);
    }
  }
  await redisCmd("del", mcpReadLeaseKey(request.kind));
}

async function processMcpReadRequest(kind, run) {
  const claim = await claimMcpReadRequest(kind);
  if (!claim) return;
  const { request } = claim;
  try {
    const outcome = await run(request);
    await recordMcpReadReceipt(claim, { ok: outcome !== "mismatch", outcome: outcome ?? "ok" });
  } catch (error) {
    const safeError = safeMcpReadError(error);
    console.error(`[companion] ${kind} MCP read failed:`, safeError);
    await recordMcpReadReceipt(claim, { ok: false, outcome: "failed", error: safeError });
    // Leave the request durable. The next heartbeat may retry after the lease
    // expires; request-id idempotency prevents a duplicate Performance row.
    // Repeated failures back off so a persistent fault (expired CLI login)
    // does not rewrite receipts and history every few minutes.
    const failures = (mcpReadConsecutiveFailures.get(kind) ?? 0) + 1;
    mcpReadConsecutiveFailures.set(kind, failures);
    await redisPost(["set", mcpReadLeaseKey(request.kind), request.id, "EX", mcpReadRetryLeaseSeconds(failures, MCP_READ_LEASE_SECONDS)]).catch(() => null);
    return;
  }
  mcpReadConsecutiveFailures.delete(kind);
}

async function getProposal(id) {
  const raw = await redisCmd("get", `pm:approval_proposal:${id}`);
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

async function setProposalField(id, updates) {
  if (!PORTFOLIO_BACKEND_URL || !PORTFOLIO_WEBHOOK_SECRET) {
    throw new Error("PORTFOLIO_BACKEND_URL and PORTFOLIO_WEBHOOK_SECRET are required for companion proposal state");
  }
  const response = await fetch(`${PORTFOLIO_BACKEND_URL}/companion/proposal-state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PORTFOLIO_WEBHOOK_SECRET}`,
    },
    body: JSON.stringify({ proposalId: id, patch: updates }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`companion proposal-state failed: ${body?.error ?? `HTTP ${response.status}`}`);
  return body;
}

async function acquireLock(id) {
  // SET NX EX — returns "OK" if acquired, null if already locked
  const result = await redisPost(["set", `pm:exec_lock:${id}`, "1", "NX", "EX", LOCK_TTL_SECONDS]);
  return result === "OK";
}

async function releaseLock(id) {
  await redisCmd("del", `pm:exec_lock:${id}`);
}

// ── Telegram alerts ────────────────────────────────────────────────────────────
// Execution problems must page Sam, not just sit in PM2 logs.
async function alertTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  console.error(`[companion] ALERT: ${message}`);
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `🚨 Portfolio executor: ${message}` }),
    });
  } catch (err) {
    console.error("[companion] Telegram alert failed:", err.message);
  }
}

function extractJsonObject(stdout, predicate) {
  const starts = [];
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] === "{") starts.push(i);
  }
  for (const start of starts.reverse()) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < stdout.length; i++) {
      const ch = stdout[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(stdout.slice(start, i + 1));
            if (!predicate || predicate(parsed)) return { parsed, text: stdout.slice(start, i + 1) };
          } catch {}
          break;
        }
      }
    }
  }
  return null;
}

function extractClaudeFinalText(stdout) {
  const resultTexts = [];
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && typeof event.result === "string") resultTexts.push(event.result);
    } catch {}
  }
  if (!resultTexts.length) throw new Error("Claude stream did not include a final result");
  return resultTexts.at(-1);
}

// ── Claude executor ────────────────────────────────────────────────────────────
async function executeViaClaude(proposal) {
  const { id, ticker, side } = proposal;
  if (!AGENTIC_ACCOUNT_NUMBER) {
    throw new Error("ROBINHOOD_ACCOUNT_NUMBER is required to execute a trade on the pinned Agentic account.");
  }
  const orderInstructions = buildOrderInstructions(proposal);

  const prompt = `Use the Robinhood MCP to place the following trade ONLY on configured Agentic account ${AGENTIC_ACCOUNT_NUMBER}.

First call get_accounts. Verify that account ${AGENTIC_ACCOUNT_NUMBER} is present and marked agentic_allowed. If it is missing or not agentic_allowed, place NO order and respond with ok=false. Never use a default, margin, IRA, or any other account.

Ticker: ${ticker}
Side: ${side.toUpperCase()}
${orderInstructions}

IDEMPOTENCY — CRITICAL: pass ref_id "${id}" (exactly this UUID) AND account_number "${AGENTIC_ACCOUNT_NUMBER}" to place_equity_order. If you retry after a transient failure, re-send the SAME ref_id so the broker deduplicates.

IMPORTANT: Place the order now — skip the review step, do not ask for confirmation. After placing, respond with ONLY this JSON (no other text):
{"ok": true, "accountNumber": "${AGENTIC_ACCOUNT_NUMBER}", "orderId": "...", "shares": 0.0, "price": 0.00, "message": "brief status"}

Use the actual average fill price for "price". On failure respond with ONLY:
{"ok": false, "error": "reason"}`;

  // Strip ANTHROPIC_API_KEY so claude uses claude.ai login (which has Robinhood auth)
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const { stdout, stderr } = await runClaude(
    robinhoodClaudeArgs({ prompt, allowedTools: MCP_EXECUTION_TOOLS, stream: true }),
    { env, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 }
  );

  if (stderr) console.warn(`[companion] claude stderr:`, stderr.trim());

  const finalText = extractClaudeFinalText(stdout);
  const extracted = extractJsonObject(finalText, (p) => typeof p.ok === "boolean");
  if (!extracted) throw new Error(`No valid JSON in Claude output: ${finalText.slice(0, 300)}`);
  const result = extracted.parsed;

  const placedOrders = extractMcpToolCalls(stdout)
    .filter((call) => call.name === "mcp__robinhood-trading__place_equity_order");
  if (placedOrders.length) {
    assertScheduledMcpAccountBinding(stdout, ["mcp__robinhood-trading__place_equity_order"], AGENTIC_ACCOUNT_NUMBER);
  }
  if (result.ok) {
    if (result.accountNumber !== AGENTIC_ACCOUNT_NUMBER) {
      throw new Error("Broker result did not confirm the configured Agentic account.");
    }
    if (!placedOrders.length) {
      throw new Error("Broker reported success without a traceable Agentic-account order call.");
    }
  }
  return result;
}

/**
 * Reconciles a proposal stuck in executionState "Executing" (we started an order
 * attempt but never confirmed the outcome — crash, timeout, sleep, or a failed
 * record step). Asks the broker what actually happened instead of re-executing.
 */
async function reconcileViaClaude(proposal) {
  const { id, ticker, executionStartedAt, executionOrderId } = proposal;
  const sinceIso = new Date(new Date(executionStartedAt ?? Date.now()).getTime() - 10 * 60 * 1000).toISOString();
  const exactMatchInstruction = isPlausibleOrderId(executionOrderId)
    ? `Return found=true ONLY for the broker order whose order ID is exactly "${executionOrderId}". The returned order ID must exactly equal "${executionOrderId}". Robinhood may omit ref_id, so do not require ref_id when this exact broker order ID is available.`
    : `Return found=true ONLY for the order whose ref_id is exactly "${id}". If ref_id is missing or not visible, return found=false.`;

  const prompt = `Use the Robinhood MCP (read-only order tools) on my Agentic account. Do NOT place, cancel, or modify any order.

First call get_accounts and verify that account ${AGENTIC_ACCOUNT_NUMBER} is present and marked agentic_allowed. Then call get_equity_orders with account_number exactly ${AGENTIC_ACCOUNT_NUMBER}, symbol ${ticker}, and created_at_gte ${sinceIso}.

${exactMatchInstruction} Never guess from ticker, time, or recency.

Respond with ONLY this JSON (no other text):
{"found": true, "orderId": "...", "state": "filled|new|queued|confirmed|partially_filled|cancelled|rejected|failed", "shares": 0.0, "price": 0.00}
or, if no matching order exists:
{"found": false}`;

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const { stdout } = await runClaude(
    robinhoodClaudeArgs({ prompt, allowedTools: MCP_RECONCILE_TOOLS, disallowedTools: MARKET_SYNC_DISALLOWED_TOOLS, stream: true }),
    { env, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 }
  );

  assertScheduledMcpAccountBinding(stdout, ["mcp__robinhood-trading__get_equity_orders"], AGENTIC_ACCOUNT_NUMBER);
  const finalText = extractClaudeFinalText(stdout);
  const extracted = extractJsonObject(finalText, (p) => typeof p.found === "boolean");
  if (!extracted) throw new Error(`No valid reconcile JSON in claude output: ${finalText.slice(0, 300)}`);
  return extracted.parsed;
}

// Market-hours check now lives in companion-core.mjs (holiday-aware, proper
// ET conversion via Intl instead of the old approximate DST math).

// ── Trade ledger + lots ────────────────────────────────────────────────────────
async function recordTrade(proposal, result) {
  // A real order happened by the time this runs — failing to record it corrupts
  // the FIFO/attribution books, so every problem here must THROW (the caller
  // keeps the proposal in Executing state and retries), never silently skip.
  if (!result.orderId) throw new Error("record-trade: missing orderId from execution result");
  const shares = Number(result.shares);
  if (!Number.isFinite(shares) || shares <= 0) throw new Error(`record-trade: invalid shares "${result.shares}"`);
  const price = Number(result.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`record-trade: invalid price "${result.price}"`);

  if (!PORTFOLIO_BACKEND_URL || !PORTFOLIO_WEBHOOK_SECRET) {
    throw new Error("PORTFOLIO_BACKEND_URL and PORTFOLIO_WEBHOOK_SECRET are required to record a trade");
  }
  const response = await fetch(`${PORTFOLIO_BACKEND_URL}/record-trade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PORTFOLIO_WEBHOOK_SECRET}`,
    },
    body: JSON.stringify({ proposalId: proposal.id, orderId: result.orderId, ticker: proposal.ticker, side: proposal.side, shares, price, agentId: proposal.agentId }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`record-trade failed: ${body?.error ?? `HTTP ${response.status}`}`);
  if (body.needsReconciliation) throw new Error("record-trade requires lot reconciliation; proposal remains unfulfilled");
  console.log("[companion] ✓ Trade recorded by Jetson financial writer");
}

// ── Holdings sync ─────────────────────────────────────────────────────────────
const SYNC_SCRIPT = join(__dir, "../../portfolio-manager/scripts/sync-holdings-from-mcp.js");

async function syncHoldings({ requestId = null, invocationId = null } = {}) {
  if (!existsSync(SYNC_SCRIPT)) {
    throw new Error("sync-holdings-from-mcp.js not found");
  }
  if (!AGENTIC_ACCOUNT_NUMBER) throw new Error("ROBINHOOD_ACCOUNT_NUMBER is required for an MCP holdings sync.");

  const prompt = `Use ONLY the Robinhood MCP read tools available to you. Do not place, review, cancel, or modify any order or saved broker object.

First call get_accounts and verify that account ${AGENTIC_ACCOUNT_NUMBER} is the active Agentic account. Then call get_equity_positions and get_portfolio with account_number exactly ${AGENTIC_ACCOUNT_NUMBER}. Do not query another account. Stop with an error if that account is not agentic_allowed.
Return ONLY this JSON — no other text, no markdown:
{"accountNumber":"the account number returned by get_accounts","positions":[{"ticker":"NVDA","name":"NVIDIA Corporation","shares":0.076,"avgCost":196.38,"currentPrice":196.40}],"cash":12.34}
Include every open position. Use the actual live values from the MCP.`;

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  let stdout;
  try {
    ({ stdout } = await runClaude(
      robinhoodClaudeArgs({ prompt, allowedTools: MCP_SNAPSHOT_TOOLS, stream: true }),
      { env, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 }
    ));
  } catch (err) {
    throw new Error(`failed to fetch positions from Robinhood: ${err.message}`);
  }

  try {
    assertScheduledMcpAccountBinding(stdout, [
      "mcp__robinhood-trading__get_equity_positions",
      "mcp__robinhood-trading__get_portfolio",
    ], AGENTIC_ACCOUNT_NUMBER);
  } catch (error) {
    console.error("[companion] holdings-sync MCP evidence summary:", JSON.stringify(summarizeMcpStream(stdout)));
    throw error;
  }
  const finalText = extractClaudeFinalText(stdout);

  // Extract the JSON blob from claude output
  let positionsJson;
  const blocks = [...finalText.matchAll(/\{(?:[^{}]|\{[^{}]*\})*\}/gs)];
  for (const b of blocks.reverse()) {
    try {
      const p = JSON.parse(b[0]);
      if (Array.isArray(p.positions) && p.accountNumber === AGENTIC_ACCOUNT_NUMBER) { positionsJson = b[0]; break; }
    } catch {}
  }
  if (!positionsJson) {
    throw new Error("could not parse a verified account positions response from Robinhood MCP");
  }

  // Pipe positions JSON into sync-holdings-from-mcp.js, run from portfolio-manager dir so
  // dotenv + credentials.json resolve correctly
  const syncDir = join(__dir, "../../portfolio-manager");
  await new Promise((resolve, reject) => {
    const args = [
      SYNC_SCRIPT,
      ...buildHoldingsSyncProvenanceArgs({ requestId, invocationId }),
    ];
    const child = execFile("node", args, { env: process.env, cwd: syncDir, timeout: 120_000 }, (err) => {
      if (err) reject(err); else resolve();
    });
    child.stdin.write(positionsJson);
    child.stdin.end();
  });

  console.log(`[companion] ✓ Holdings synced to Google Sheets${requestId ? ` (request ${requestId})` : ""}${invocationId ? ` (slot ${invocationId})` : ""}`);
}

// ── Market scan sync ─────────────────────────────────────────────────────────
const MARKET_SYNC_SCRIPT = join(__dir, "../../portfolio-manager/scripts/sync-market-scans-from-mcp.js");

async function setMarketScanStatus(status) {
  await redisPost(["set", "pm:market-scans:status", JSON.stringify({
    ...status,
    updatedAt: new Date().toISOString(),
  }), "EX", 3600]).catch(() => null);
}

async function runMarketScanSync() {
  if (!existsSync(MARKET_SYNC_SCRIPT)) {
    console.warn("[companion] sync-market-scans-from-mcp.js not found — skipping market scan sync");
    return;
  }

  await setMarketScanStatus({ state: "running", count: 0, error: null });

  const prompt = `Use only Robinhood MCP read-only scanner, quote, fundamentals, technical indicator, earnings, portfolio, and position tools.
Do not place, review, cancel, or modify any order. Do not create or update saved scans or watchlists.

Task:
1. Get my saved Robinhood scans.
2. Run the most useful scans for discovering equity candidates. Prefer momentum/relative-volume, oversold-quality/pullback, earnings/catalyst, and large-cap strength scans when present.
3. Add enough quote/market data to make each candidate useful for research.

Return ONLY this JSON — no markdown, no prose:
{
  "syncedAt": "ISO timestamp",
  "scans": [
    {
      "scanName": "Momentum + Volume",
      "results": [
        {
          "ticker": "NVDA",
          "name": "NVIDIA Corporation",
          "price": 196.40,
          "changePct": 2.1,
          "volume": 12345678,
          "avgVolume": 9876543,
          "marketCap": 4800000000000,
          "signal": "Why this scan surfaced the ticker",
          "score": 92,
          "agentHint": "agent-1",
          "notes": "One brief extra market-data note"
        }
      ]
    }
  ]
}

Use agentHint only when obvious: agent-1 for high-growth technology/software/semis, agent-2 for financials/healthcare/quality compounders, agent-3 for defensive/consumer/industrial/dividend names. Otherwise leave agentHint empty. Limit total results to the 40 best rows.`;

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  let stdout;
  try {
    ({ stdout } = await runClaude(
      robinhoodClaudeArgs({ prompt, allowedTools: ROBINHOOD_MCP_TOOLS, disallowedTools: MARKET_SYNC_DISALLOWED_TOOLS }),
      { env, timeout: 180_000 }
    ));
  } catch (err) {
    console.warn("[companion] market scan: failed to fetch scans from Robinhood:", err.message);
    await setMarketScanStatus({ state: "error", count: 0, error: err.message });
    return;
  }

  const extracted = extractJsonObject(stdout, (p) => Array.isArray(p.scans) || Array.isArray(p.results));
  if (!extracted) {
    console.warn("[companion] market scan: could not parse scan JSON from claude output");
    await setMarketScanStatus({ state: "error", count: 0, error: "Could not parse scan JSON from Claude output" });
    return;
  }

  const syncDir = join(__dir, "../../portfolio-manager");
  await new Promise((resolve, reject) => {
    const child = execFile("node", [MARKET_SYNC_SCRIPT], { env: process.env, cwd: syncDir }, (err) => {
      if (err) reject(err); else resolve();
    });
    child.stdin.write(extracted.text);
    child.stdin.end();
  });

  console.log("[companion] ✓ Market scans synced to Google Sheets");
}

// ── Execution + reconciliation handlers ──────────────────────────────────────

/** Records the trade in the ledger, then (only on success) marks fulfilled. */
async function recordAndFulfill(id, proposal, { orderId, shares, price }) {
  try {
    const sellFillScope = verifySellFillWithinOwnerShareCeiling(proposal, shares);
    if (!sellFillScope.ok) throw new Error(sellFillScope.reason);
    await recordTrade(proposal, { orderId, shares, price });
  } catch (err) {
    // Money moved but the ledger write failed. Do NOT mark fulfilled — the
    // Executing state + stored order fields make the next poll retry recording
    // without touching the broker again.
    await setProposalField(id, {
      executionState: "Executing",
      executionOrderId: orderId,
      executionShares: shares,
      executionPrice: price,
    });
    await alertTelegram(`Trade EXECUTED but ledger recording FAILED for ${proposal.side} $${proposal.amountDollars} ${proposal.ticker} (proposal ${id}, order ${orderId}): ${err.message}. Will retry recording next poll.`);
    return false;
  }
  console.log(`[companion] ✓ ${id} fulfilled — order ${orderId}, ${shares} shares`);
  return true;
}

async function executeProposal(id, proposal) {
  console.log(`[companion] Executing proposal ${id}: ${proposal.side} $${proposal.amountDollars} ${proposal.ticker}`);

  // Mark Executing BEFORE the order goes out. If we die mid-flight, the next
  // poll reconciles against the broker instead of double-executing.
  await setProposalField(id, {
    executionState: "Executing",
    executionStartedAt: new Date().toISOString(),
  });

  let result;
  try {
    result = await executeViaClaude(proposal);
  } catch (err) {
    // Unknown outcome (timeout/crash) — leave Executing; reconcile next poll.
    await alertTelegram(`Order attempt for ${proposal.side} $${proposal.amountDollars} ${proposal.ticker} (proposal ${id}) ended with UNKNOWN outcome: ${err.message}. Will reconcile against the broker next poll.`);
    throw err;
  }

  if (result.ok) {
    // The result is regex-parsed from model stdout — a fabricated orderId must
    // not reach the ledger. Robinhood order IDs are UUIDs; anything else means
    // "outcome unknown": stay Executing and let reconciliation ask the broker.
    if (!isPlausibleOrderId(result.orderId)) {
      await alertTelegram(`Execution result for ${proposal.side} $${proposal.amountDollars} ${proposal.ticker} (proposal ${id}) reported a non-UUID orderId ("${String(result.orderId).slice(0, 40)}") — treating outcome as unknown; reconciling against the broker next poll.`);
      return;
    }
    // Robinhood currently may omit ref_id in its order history. Persist the
    // broker's own UUID before reconciliation so a restart cannot turn a real
    // fill into an untraceable, unrelated-workflow failure. This is not a
    // confirmation: reconciliation still independently reads this exact ID.
    await setProposalField(id, { executionOrderId: result.orderId });
    const brokerResult = await reconcileViaClaude({
      ...proposal,
      executionStartedAt: new Date().toISOString(),
      executionOrderId: result.orderId,
    });
    const decision = decideReconcileAction(brokerResult);
    if (decision.action !== "record" || decision.orderId !== result.orderId) {
      await alertTelegram(
        `Order result for ${proposal.side} ${proposal.ticker} (proposal ${id}) was not independently confirmed as an exact filled broker order. Leaving it in Executing for reconciliation.`
      );
      return;
    }
    await recordAndFulfill(id, proposal, {
      orderId: decision.orderId,
      shares: decision.shares,
      price: decision.price,
    });
  } else {
    // The model REPORTED failure, but that's not proof no order was placed —
    // keep Executing so the next poll verifies with the broker before retrying.
    console.error(`[companion] ✗ ${id} reported failure:`, result.error);
    await alertTelegram(`Order attempt for ${proposal.side} $${proposal.amountDollars} ${proposal.ticker} (proposal ${id}) reported failure: ${result.error}. Verifying against broker next poll.`);
  }
}

async function reconcileProposal(id, proposal) {
  console.log(`[companion] Reconciling proposal ${id} (${proposal.side} ${proposal.ticker}) against broker...`);

  // Ask the broker on every retry, even if an earlier process stored an order
  // ID. Stored process state is not broker confirmation.
  // in companion-core.mjs (tested in tests/companion-core.test.ts).
  const rec = await reconcileViaClaude(proposal);
  const decision = decideReconcileAction(rec);

  if (decision.action === "record") {
    if (proposal.executionOrderId && proposal.executionOrderId !== decision.orderId) {
      await alertTelegram(`Reconciliation order mismatch for proposal ${id}: stored ${proposal.executionOrderId}, broker returned ${decision.orderId}. Manual review required.`);
      return;
    }
    await recordAndFulfill(id, proposal, { orderId: decision.orderId, shares: decision.shares, price: decision.price });
  } else if (decision.action === "fail") {
    const failureReason = decision.reason ?? "broker execution was not confirmed";
    console.error(`[companion] ${id}: ${failureReason} — marking approval terminal; fresh signed proposal required.`);
    await setProposalField(id, {
      status: "ExecutionFailed",
      executionState: "BrokerRejected",
      executionFailedAt: new Date().toISOString(),
      executionFailureReason: failureReason,
    });
    await alertTelegram(`Order for ${proposal.side} ${proposal.ticker} (proposal ${id}) failed: ${failureReason}. It is terminal and will not retry; create and sign a fresh proposal after a new broker-position check.`);
  } else {
    // Still working (new/queued/confirmed/partially_filled) — leave Executing, check again next poll.
    console.log(`[companion] ${id}: broker order ${rec.orderId ?? "?"} still ${rec.state ?? "working"} — waiting.`);
  }
}

// ── Daily broker-vs-ledger reconciliation ─────────────────────────────────────
// After each market close, fetch the day's equity orders (READ-ONLY) and diff
// them against the Trade Ledger via portfolio-manager/scripts/reconcile-orders.js.
// A filled order missing from the ledger means an execution/recording failure
// slipped through — the script Telegrams the details. Report-only; never writes.
const RECONCILE_SCRIPT = join(__dir, "../../portfolio-manager/scripts/reconcile-orders.js");

function easternStartIso(dateEt) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${dateEt}T12:00:00.000Z`));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value?.replace("GMT", "") || "-05:00";
  return `${dateEt}T00:00:00${offset}`;
}

async function runDailyReconciliation(todayEt) {
  if (!existsSync(RECONCILE_SCRIPT)) {
    throw new Error("reconcile-orders.js not found");
  }
  if (!AGENTIC_ACCOUNT_NUMBER) throw new Error("ROBINHOOD_ACCOUNT_NUMBER is required for MCP reconciliation.");

  const prompt = `Use ONLY the Robinhood MCP read tools available to you. Do not place, review, cancel, or modify any order or saved broker object.

First call get_accounts and verify that account ${AGENTIC_ACCOUNT_NUMBER} is the active Agentic account. Then call get_equity_orders with account_number exactly ${AGENTIC_ACCOUNT_NUMBER} and created_at_gte ${easternStartIso(todayEt)}; collect every order (paginate if needed). Do not query another account. Stop with an error if that account is not agentic_allowed.

Respond with ONLY this JSON (no other text):
{"accountNumber":"the account number returned by get_accounts","orders":[{"orderId":"...","ticker":"NVDA","side":"BUY","state":"filled","shares":0.0,"price":0.00,"filledAt":"ISO timestamp"}]}
Include ALL states as reported (filled, cancelled, rejected, ...). If there are no orders, respond {"accountNumber":"the account number returned by get_accounts","orders":[]}.`;

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const { stdout } = await runClaude(
    robinhoodClaudeArgs({ prompt, allowedTools: MCP_RECONCILE_TOOLS, stream: true }),
    { env, timeout: 180_000, maxBuffer: 5 * 1024 * 1024 }
  );

  try {
    assertScheduledMcpAccountBinding(stdout, ["mcp__robinhood-trading__get_equity_orders"], AGENTIC_ACCOUNT_NUMBER);
  } catch (error) {
    console.error("[companion] reconciliation MCP evidence summary:", JSON.stringify(summarizeMcpStream(stdout)));
    throw error;
  }

  const extracted = extractJsonObject(extractClaudeFinalText(stdout), (p) => Array.isArray(p.orders) && p.accountNumber === AGENTIC_ACCOUNT_NUMBER);
  if (!extracted) throw new Error("No valid verified-account orders JSON in Claude output.");

  return new Promise((resolve, reject) => {
    const child = execFile(
      "node",
      [RECONCILE_SCRIPT],
      { env: process.env, cwd: join(__dir, "../../portfolio-manager") },
      (err, out) => {
        if (out) console.log(`[companion] reconcile: ${String(out).trim()}`);
        // Exit code 2 = mismatches found; the script already Telegrammed them.
        if (err && err.code !== 2) reject(err);
        else resolve(err?.code === 2 ? "mismatch" : "ok");
      }
    );
    child.stdin.write(extracted.text);
    child.stdin.end();
  });
}

// ── Main poll loop ─────────────────────────────────────────────────────────────
async function poll(force = false) {
  if (!COMPANION_ROLE.execution) return;
  if (!force && !isMarketOpen()) {
    console.log(`[companion] Market closed — skipping poll`);
    return;
  }
  try {
    const ids = await redisCmd("lrange", LIST_KEY, "0", "99");
    if (!ids?.length) return;

    for (const id of ids) {
      const proposal = await getProposal(id);
      if (!proposal) continue;
      if (proposal.status !== "ApprovedForBrokerReview") continue;
      if (proposal.fulfilledAt) continue;

      // Verify BEFORE any handler touches the broker: an unsigned/forged
      // "approval" written straight into Redis must never trade.
      const sig = verifyApprovalSignature(proposal, process.env.AUDIT_HMAC_SECRET?.trim());
      if (!sig.ok) {
        await alertTelegram(`REFUSED proposal ${id} (${proposal.side} $${proposal.amountDollars} ${proposal.ticker}): ${sig.reason}.`);
        continue;
      }
      const sellScope = verifySellOwnerShareCeiling(proposal);
      if (!sellScope.ok) {
        await alertTelegram(`REFUSED proposal ${id} (${proposal.side} $${proposal.amountDollars} ${proposal.ticker}): ${sellScope.reason}.`);
        continue;
      }

      const locked = await acquireLock(id);
      if (!locked) {
        console.log(`[companion] ${id} already being processed, skipping`);
        continue;
      }

      try {
        if (proposal.executionState === "ManualReview") {
          // A manager-confirmed broker fill that cannot be proved from the
          // proposal ref_id must never be guessed or retried. Keep it out of
          // the execution loop until the signed ledger is reconciled.
          console.warn(`[companion] ${id} is held for manual broker reconciliation; skipping execution.`);
        } else if (proposal.executionState === "Executing") {
          // A previous attempt started but never confirmed its outcome (crash,
          // sleep, timeout, or failed ledger recording). NEVER blindly re-execute
          // — ask the broker what happened first.
          await reconcileProposal(id, proposal);
        } else {
          await executeProposal(id, proposal);
        }
      } catch (err) {
        console.error(`[companion] ✗ ${id} exception:`, err.message);
      } finally {
        await releaseLock(id);
      }
    }
  } catch (err) {
    console.error("[companion] Poll error:", err.message);
  }
}

async function heartbeat() {
  // Keep execution and broker-reader liveness distinct during split-host
  // operation; one healthy role must never conceal failure of the other.
  // Broker-read roles fold the heartbeat and the idle queue check into one
  // Redis command; if it fails every kind is checked (the older, costlier path).
  let pendingReads = null;
  if (COMPANION_ROLE.brokerReads) {
    const keys = [COMPANION_ROLE.heartbeatKey];
    for (const kind of SCHEDULED_MCP_READ_KINDS) keys.push(mcpReadRequestKey(kind), mcpReadQueueKey(kind), mcpReadLeaseKey(kind));
    pendingReads = await redisPost(["eval", HEARTBEAT_AND_PENDING_SCRIPT, String(keys.length), ...keys, new Date().toISOString(), "3600"]).catch(() => null);
    if (!Array.isArray(pendingReads)) pendingReads = null;
  } else {
    await redisPost(["set", COMPANION_ROLE.heartbeatKey, new Date().toISOString(), "EX", 3600]).catch(() => null);
  }

  if (COMPANION_ROLE.execution) {
    const triggered = await redisCmd("getdel", "pm:exec_trigger").catch(() => null);
    if (triggered) {
      console.log(`[companion] Manual trigger received — running immediate poll`);
      await poll(true);
    }
  }

  if (COMPANION_ROLE.marketScans) {
    const marketTriggered = await redisCmd("getdel", "pm:market_scan_trigger").catch(() => null);
    if (marketTriggered) {
      console.log(`[companion] Market scan trigger received — syncing Robinhood scans`);
      await runMarketScanSync();
    }
  }

  if (COMPANION_ROLE.brokerReads) {
    const due = (kind) => pendingReads === null || Number(pendingReads[SCHEDULED_MCP_READ_KINDS.indexOf(kind)]) === 1;
    if (due("holdings-sync")) {
      await processMcpReadRequest("holdings-sync", async (request) => {
        await syncHoldings({ requestId: request.id, invocationId: request.invocationId });
        return "ok";
      });
    }
    if (due("order-reconciliation")) {
      await processMcpReadRequest("order-reconciliation", (request) => runDailyReconciliation(request.requestedForET));
    }
  }
}

let heartbeatInFlight = false;
async function heartbeatTick() {
  if (heartbeatInFlight) {
    console.warn("[companion] Heartbeat still running — skipping overlapping tick");
    return;
  }
  heartbeatInFlight = true;
  try {
    await heartbeat();
  } catch (error) {
    console.error("[companion] Heartbeat error:", error.message);
  } finally {
    heartbeatInFlight = false;
  }
}

console.log(
  `[companion] Starting role=${COMPANION_ROLE.name} `
  + `execution=${COMPANION_ROLE.execution} brokerReads=${COMPANION_ROLE.brokerReads} `
  + `marketScans=${COMPANION_ROLE.marketScans}`
);
if (COMPANION_ROLE.execution) poll(); // run immediately on start
heartbeatTick();
if (COMPANION_ROLE.execution) setInterval(poll, POLL_INTERVAL_MS);
setInterval(() => void heartbeatTick(), 30_000); // serialized, top-level-caught trigger/MCP loop
