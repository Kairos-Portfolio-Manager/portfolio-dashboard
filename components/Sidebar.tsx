'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePortfolio } from '@/components/PortfolioProvider';
import type { PortfolioRole } from '@/lib/rbac';

type NavItem = {
  href: string;
  label: string | Record<PortfolioRole, string>;
  roles: PortfolioRole[];
};

const links: NavItem[] = [
  { href: '/', label: 'Command', roles: ['FundManager'] },
  { href: '/holdings', label: 'Positions', roles: ['FundManager'] },
  { href: '/investors', label: { FundManager: 'Investors', Client: 'My Investment' }, roles: ['FundManager', 'Client'] },
  { href: '/agents', label: 'Agents', roles: ['FundManager'] },
  { href: '/portfolio-manager', label: 'Kairos', roles: ['FundManager'] },
  { href: '/research', label: 'Labs', roles: ['FundManager'] },
  { href: '/pitch-lab', label: 'Pitch Lab', roles: ['FundManager'] },
];

/**
 * The 54px app header. The file keeps its historical name so existing imports
 * stay stable, but it is a top-level header rather than a sidebar: solid panel,
 * hairline rule beneath, full-height blocks divided by vertical rules. The
 * screen name lives here, never in a page H1.
 */
export default function Sidebar({ role }: { role: PortfolioRole }) {
  const pathname = usePathname();
  const { user } = useUser();
  const { data } = usePortfolio();
  const visibleLinks = links.filter((link) => link.roles.includes(role));

  const initials =
    [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('') ||
    user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() ||
    '—';

  return (
    <header
      className="sticky top-0 z-50 flex items-stretch justify-between"
      style={{
        height: 54,
        background: 'var(--panel)',
        borderBottom: '1px solid var(--rule-head)',
      }}
    >
      <div className="flex items-center" style={{ gap: 26, paddingLeft: 22 }}>
        <Link
          href={role === 'Client' ? '/investors' : '/'}
          className="flex shrink-0 items-center no-underline hover:no-underline"
          style={{
            gap: 10,
            height: 54,
            paddingRight: 26,
            borderRight: '1px solid var(--rule-header-block)',
            color: 'var(--ink)',
          }}
        >
          <span
            className="flex items-center justify-center font-serif"
            style={{
              width: 26,
              height: 26,
              border: '1px solid var(--ink)',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            PM
          </span>
          <span className="flex flex-col" style={{ gap: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em' }}>
              Portfolio Manager
            </span>
            <span
              style={{
                fontSize: 9.5,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
                color: 'var(--muted-2)',
              }}
            >
              Private Wealth Office
            </span>
          </span>
        </Link>

        <nav aria-label="Primary navigation" className="flex items-stretch" style={{ height: 54, gap: 2 }}>
          {visibleLinks.map((link) => {
            const active = pathname === link.href;
            const label = typeof link.label === 'string' ? link.label : link.label[role];
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className="flex items-center no-underline hover:no-underline"
                style={{
                  padding: '0 13px',
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: active ? 'var(--ink)' : 'var(--muted)',
                  boxShadow: active ? 'inset 0 -2px 0 var(--accent)' : 'none',
                  transition: 'color 120ms linear',
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center">
        <div
          className="hidden items-center md:flex"
          style={{
            gap: 7,
            padding: '0 18px',
            height: 54,
            borderLeft: '1px solid var(--rule-header-block)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: data?.lastSynced ? '#3f7d5c' : 'var(--disabled)',
            }}
          />
          <span className="pm-num" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {data?.lastSynced ? `Synced ${data.lastSynced}` : 'Awaiting sync'}
          </span>
        </div>

        <div
          className="flex items-center"
          style={{
            gap: 10,
            padding: '0 20px 0 18px',
            height: 54,
            borderLeft: '1px solid var(--rule-header-block)',
          }}
        >
          <div className="hidden text-right sm:block">
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{user?.fullName ?? 'Account holder'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>
              {role === 'Client' ? 'Capital account' : 'Fund manager'}
            </div>
          </div>
          <UserButton
            appearance={{
              elements: {
                userButtonAvatarBox: {
                  width: 28,
                  height: 28,
                  borderRadius: 0,
                  border: '1px solid var(--rule)',
                },
                userButtonAvatarImage: { borderRadius: 0 },
                avatarBox: { borderRadius: 0 },
              },
            }}
            fallback={
              <span
                className="flex items-center justify-center"
                style={{
                  width: 28,
                  height: 28,
                  background: 'var(--chip)',
                  border: '1px solid var(--rule)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: 'var(--ink-2)',
                }}
              >
                {initials}
              </span>
            }
          />
        </div>
      </div>
    </header>
  );
}
