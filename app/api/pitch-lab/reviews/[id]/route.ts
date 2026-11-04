import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { REVIEW_ID_RE, REVIEW_KEY_PREFIX, parseStored, type MandateReview } from "@/lib/pitch-lab";

/** One stored review period. The id must be a stored review id, so the key never leaves `pitchlab:`. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireApiPermission({
    permission: "portfolio:full",
    action: "PITCH_LAB_READ",
    request: req,
  });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!REVIEW_ID_RE.test(id)) {
    return NextResponse.json({ error: "Unknown review." }, { status: 404 });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis is not configured." }, { status: 503 });
  }

  const envelope = parseStored(await redis.get(`${REVIEW_KEY_PREFIX}${id}`)) as { publishedAt?: string; review?: MandateReview } | null;
  if (!envelope?.review) {
    return NextResponse.json({ error: "Unknown review." }, { status: 404 });
  }
  return NextResponse.json({ review: envelope.review, publishedAt: envelope.publishedAt ?? null });
}
