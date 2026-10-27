import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { getRedis } from "@/lib/redis";

const MANDATE_REVIEW_KEY = "pitchlab:mandate-review";
const SNAPSHOT_KEY = "pitchlab:snapshot";

export async function GET(req: NextRequest) {
  const authz = await requireApiPermission({
    permission: "portfolio:full",
    action: "PITCH_LAB_READ",
    request: req,
  });
  if (!authz.ok) return authz.response;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis is not configured." }, { status: 503 });
  }

  const [reviewRaw, snapshotRaw] = await Promise.all([
    redis.get(MANDATE_REVIEW_KEY),
    redis.get(SNAPSHOT_KEY),
  ]);

  const envelope = reviewRaw
    ? typeof reviewRaw === "string" ? JSON.parse(reviewRaw) : reviewRaw
    : null;

  const snapshot = snapshotRaw
    ? typeof snapshotRaw === "string" ? JSON.parse(snapshotRaw) : snapshotRaw
    : null;

  return NextResponse.json({
    review: envelope?.review ?? null,
    publishedAt: envelope?.publishedAt ?? null,
    snapshot: snapshot?.snapshot ?? null,
  });
}
