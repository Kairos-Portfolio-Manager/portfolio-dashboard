import { createHmac } from "crypto";
import { getRedis } from "./redis";
import type { PortfolioRole } from "./rbac";

export type AuditAction =
  | "AUTH_FAILURE"
  | "RBAC_REJECT"
  | "RED_LINE_BLOCK"
  | "PORTFOLIO_READ"
  | "SIGNALS_READ"
  | "NEWS_READ"
  | "STRATEGY_READ"
  | "STRATEGY_EDIT"
  | "RESEARCH_GENERATE"
  | "COMPARE_GENERATE"
  | "REPORT_EXPORT"
  | "REPORT_HISTORY_READ"
  | "RESEARCH_REVIEW_HISTORY_READ"
  | "MARKET_SCANS_READ"
  | "MARKET_SCAN_SYNC"
  | "AGENT_CHAT_READ"
  | "AGENT_CHAT_SEND"
  | "AGENT_BOOK_READ"
  | "WITHDRAWAL_PREVIEW"
  | "INVESTORS_READ"
  | "APPROVAL_QUEUE_READ"
  | "PROPOSAL_CREATE"
  | "APPROVAL_DECISION"
  | "PROPOSAL_EDIT"
  | "ROBINHOOD_CONNECT"
  | "ROBINHOOD_STATUS"
  | "PROPOSAL_EXECUTE"
  | "ALERTS_READ"
  | "ALERT_CREATE"
  | "ALERT_DELETE"
  | "COMPANION_TRIGGER"
  | "COMPANION_STATUS_READ"
  | "LAB_RESEARCH_RUN"
  | "LAB_RESEARCH_POLL"
  | "INVESTOR_CONTRIBUTION_RECORD"
  | "ACTIVITY_READ"
  | "PORTFOLIO_MANAGER_SHADOW_READ"
  | "OBSERVATION_READ"
  | "OBSERVATION_UPDATE_POST"
  | "RATE_LIMIT_REJECT"
  | "PITCH_LAB_READ";

export interface AuditEventInput {
  userId?: string | null;
  role?: PortfolioRole | null;
  action: AuditAction;
  route: string;
  metadata?: Record<string, unknown>;
}

interface AuditEvent extends AuditEventInput {
  timestamp: string;
}

function auditIsEnforced(): boolean {
  return process.env.AUDIT_ENFORCE === "true" || process.env.VERCEL_ENV === "production";
}

export function getAuditConfigError(): string | null {
  if (!auditIsEnforced()) return null;
  if (!process.env.AUDIT_HMAC_SECRET?.trim()) return "AUDIT_HMAC_SECRET is required when audit enforcement is enabled.";
  if (!process.env.UPSTASH_REDIS_REST_URL?.trim() || !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    return "Upstash Redis env vars are required when audit enforcement is enabled.";
  }
  return null;
}

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => sortedJson(item)).join(",")}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${sortedJson(obj[key])}`)
    .join(",")}}`;
}

function computeRowHmac(event: AuditEvent): string | null {
  const secret = process.env.AUDIT_HMAC_SECRET?.trim();
  if (!secret) {
    if (auditIsEnforced()) throw new Error("AUDIT_HMAC_SECRET is required when audit enforcement is enabled.");
    return null;
  }

  const canonical = JSON.stringify([
    event.timestamp,
    event.userId ?? null,
    event.role ?? null,
    event.action,
    event.route,
    sortedJson(event.metadata ?? {}),
  ]);

  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export async function appendAudit(input: AuditEventInput): Promise<void> {
  const configError = getAuditConfigError();
  if (configError) throw new Error(configError);

  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const event: AuditEvent = {
    timestamp,
    userId: input.userId ?? null,
    role: input.role ?? null,
    action: input.action,
    route: input.route,
    metadata: input.metadata ?? {},
  };
  const row = { ...event, rowHmac: computeRowHmac(event) };

  try {
    const redis = getRedis();
    if (!redis) {
      if (auditIsEnforced()) throw new Error("Audit Redis is not configured.");
      return;
    }
    await redis.rpush(`pm:audit:${date}`, JSON.stringify(row));
  } catch (err) {
    console.error("[Audit] Failed to append event:", err instanceof Error ? err.message : err);
    if (auditIsEnforced()) throw err;
    try {
      await getRedis()?.incr("pm:audit_fail_count");
    } catch {
      // Best-effort only. Audit failures should not take down the app.
    }
  }
}
