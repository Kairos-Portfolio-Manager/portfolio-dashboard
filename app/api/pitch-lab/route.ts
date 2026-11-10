import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { REVIEW_INDEX_KEY, SNAPSHOT_KEY, reviewIndexFrom, snapshotFromEnvelope } from "@/lib/pitch-lab";

/** Front page: the program snapshot plus the list of review periods (empty until the first review). */
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

  const [snapshotRaw, indexRaw] = await Promise.all([redis.get(SNAPSHOT_KEY), redis.get(REVIEW_INDEX_KEY)]);

  return NextResponse.json({
    snapshot: snapshotFromEnvelope(snapshotRaw),
    reviews: reviewIndexFrom(indexRaw)?.reviews ?? [],
  });
}
