"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/pitch-lab", label: "Status" },
  { href: "/pitch-lab/reviews", label: "Review periods" },
] as const;

/** Pitch Lab's two pages: program status, and the monthly review periods. */
export function PitchLabNav() {
  const pathname = usePathname() ?? "";
  const active = pathname.startsWith("/pitch-lab/reviews") ? "/pitch-lab/reviews" : "/pitch-lab";
  return (
    <nav className="pm-panel flex items-center gap-6 border-b px-[18px]" style={{ borderColor: "var(--rule)" }} aria-label="Pitch Lab">
      <span className="pm-h2 py-3 pr-2">Pitch Lab</span>
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? "page" : undefined}
          className="py-3 text-sm"
          style={{
            color: tab.href === active ? "var(--ink)" : "var(--muted)",
            borderBottom: tab.href === active ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: tab.href === active ? 600 : 400,
          }}
        >
          {tab.label}
        </Link>
      ))}
      <span className="ml-auto pm-label">Paper research only</span>
    </nav>
  );
}
