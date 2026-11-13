"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Pitch Lab's page bar, shown at the top of every Pitch Lab page — including inside a
 * single review, so you can always jump back. Add a page here and it appears everywhere.
 * `match` decides which tab is lit: the longest matching prefix wins.
 */
export const PITCH_LAB_PAGES = [
  { href: "/pitch-lab", label: "Overview", match: "/pitch-lab" },
  { href: "/pitch-lab/reviews", label: "Mandate Review", match: "/pitch-lab/reviews" },
] as const;

export function activePitchLabPage(pathname: string): string {
  const hits = PITCH_LAB_PAGES.filter((p) => pathname === p.match || pathname.startsWith(`${p.match}/`));
  return (hits.sort((a, b) => b.match.length - a.match.length)[0] ?? PITCH_LAB_PAGES[0]).href;
}

export function PitchLabNav() {
  const active = activePitchLabPage(usePathname() ?? "");
  return (
    <nav
      className="pm-panel sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-1 border-b px-[18px]"
      style={{ borderColor: "var(--rule)" }}
      aria-label="Pitch Lab pages"
    >
      <Link href="/pitch-lab" className="pm-h2 py-3 pr-2" style={{ color: "var(--ink)" }}>
        Pitch Lab
      </Link>
      {PITCH_LAB_PAGES.map((page) => {
        const on = page.href === active;
        return (
          <Link
            key={page.href}
            href={page.href}
            aria-current={on ? "page" : undefined}
            className="py-3 text-sm"
            style={{
              color: on ? "var(--ink)" : "var(--muted)",
              borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent",
              fontWeight: on ? 600 : 400,
            }}
          >
            {page.label}
          </Link>
        );
      })}
      <span className="ml-auto pm-label">Paper research only</span>
    </nav>
  );
}
