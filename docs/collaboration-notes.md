# Portfolio Dashboard Collaboration Notes

Last updated: 2026-06-15

## Current Status

This repo is the Vercel-hosted dashboard for Sam's portfolio manager system.

Production:
- https://portfolio-dashboard-ivory-five.vercel.app

GitHub:
- https://github.com/Kairos-Portfolio-Manager/portfolio-dashboard

The dashboard is functional and deployed. It now combines the original portfolio manager UI with the useful Quant.ai research workflows, then wraps everything in a new dark, investment-terminal style design.

## What Was Done

### 1. Quant.ai was folded into the dashboard

The standalone Quant.ai project is no longer the main surface. Its research features now live inside this dashboard:

- `/research` - single-company research note
- `/compare` - side-by-side company fundamentals
- `/history` - saved research/comparison reports
- Excel exports for both research and comparison reports

Important files:
- `app/api/research/route.ts`
- `app/api/compare/route.ts`
- `app/api/history/route.ts`
- `components/research/*`
- `lib/research/*`
- `lib/redis.ts`

Research data comes from Yahoo Finance. AI analysis uses Anthropic through `ANTHROPIC_API_KEY`. Report history uses Upstash Redis when configured.

### 2. The UI was fully redesigned

The old light card dashboard looked too similar to Sam's other projects. It has been replaced with a darker "Portfolio OS" / investment desk direction:

- dark graphite background
- grid texture and subtle market terminal atmosphere
- green/cyan/amber market accents
- mono numeric/data treatment
- terminal-style panels
- position blotter tables
- new command-console sidebar
- responsive mobile bottom nav

Important files:
- `app/layout.tsx`
- `app/globals.css`
- `components/Sidebar.tsx`
- `app/page.tsx`
- `app/holdings/page.tsx`
- `app/recommendations/page.tsx`
- `app/news/page.tsx`
- `app/strategy/page.tsx`
- `components/research/*`

### 3. The overview became a command center

When portfolio data is available, `/` shows:

- total value
- cash reserve
- open P/L
- total return
- portfolio vs S&P 500 normalized chart
- top capital weights
- largest position return movers

If the spreadsheet-backed portfolio feed is unavailable, the page now shows a styled offline state instead of looking broken.

### 4. Deployed and pushed

Latest production deploy completed successfully on Vercel.

Latest pushed commit:
- `3d962ac Redesign portfolio dashboard`

## Architecture

The dashboard is a Next.js App Router app.

Main data sources:
- Google Sheets for holdings, performance, recommendations, and strategy notes
- Upstash Redis for spreadsheet ID lookup and research report history
- Yahoo Finance for company fundamentals
- Anthropic for AI-written research notes

Related backend:
- `portfolio-manager` repo runs scheduled jobs that sync holdings and generate recommendations.
- This dashboard reads the outputs of that backend, mostly through Google Sheets.

## Environment Variables

Do not commit real values.

Expected variables include:
- `GOOGLE_SERVICE_ACCOUNT` or `GOOGLE_CREDENTIALS_PATH`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ANTHROPIC_API_KEY`

Local `.env.local` is ignored.

## Known Caveats

- Several pages depend on the Google Sheet + Redis being configured. If those are missing locally, APIs like `/api/portfolio`, `/api/recommendations`, `/api/news`, and `/api/strategy` can return 500s.
- This is expected in an unconfigured local clone. The UI has styled error/offline states for that.
- The dashboard does not place trades. It is research and tracking only.
- Quant.ai's old standalone repo should be treated as dormant reference code.

## How To Run Locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

To verify before pushing:

```bash
npm run lint
npm run build
```

`npm run lint` currently runs TypeScript with `tsc --noEmit`.

## Suggested Next Steps

1. Confirm the live production dashboard has all required Vercel environment variables.
2. Run the portfolio-manager backend jobs to populate real holdings/performance data.
3. Review `/research`, `/compare`, and `/history` with real reports saved to Redis.
4. Consider adding authentication before sharing more widely.
5. Add a simple collaborator README section or screenshots once the real data feed is populated.
6. Decide whether the Google Sheet remains the long-term data source or whether this should move to a database.

## Good First Review Areas

For a collaborator reviewing the code:

- `app/page.tsx` - command center layout and chart logic
- `lib/research/registry.ts` - which financial metrics are included
- `lib/research/analyze.ts` - prompt and AI behavior
- `lib/research/excel.ts` - workbook export format
- `components/research/ComparisonTable.tsx` - compare UX
- `lib/sheets.ts` - Google Sheets data contract

