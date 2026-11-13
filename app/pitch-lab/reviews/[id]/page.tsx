"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Hatch, RailBlock, ScreenGrid } from "@/components/chrome";
import { PitchLabNav } from "@/components/pitch-lab/PitchLabNav";
import { ReviewDetail } from "@/components/pitch-lab/ReviewDetail";
import type { MandateReview } from "@/lib/pitch-lab";

export default function PitchLabReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [data, setData] = useState<{ review: MandateReview; publishedAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pitch-lab/reviews/${encodeURIComponent(id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the review");
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  return (
    <>
      <PitchLabNav />
      <ScreenGrid
        main={
          error ? (
            <div className="p-6">
              <Hatch title="Review unavailable" note={error} />
            </div>
          ) : !data ? (
            <div className="p-6">
              <Hatch title="Loading…" />
            </div>
          ) : (
            <ReviewDetail review={data.review} publishedAt={data.publishedAt} />
          )
        }
        rail={
          <RailBlock title="Mandate Review">
            <Link href="/pitch-lab/reviews" className="text-sm" style={{ color: "var(--link)" }}>
              ← All Mandate Reviews
            </Link>
          </RailBlock>
        }
      />
    </>
  );
}
