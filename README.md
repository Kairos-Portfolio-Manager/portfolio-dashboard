# Portfolio Manager — Dashboard

The human side of [Portfolio Manager](https://github.com/Kairos-Portfolio-Manager/portfolio-manager): where every AI-generated trade proposal gets reviewed, and where the account's actual state — holdings, performance, research history — lives.

## What's here

- **Approvals** — every pending proposal (buy/sell/hold, sizing, thesis, risks, kill criterion) in one queue. Approving one produces a signed authorization the execution worker can act on; nothing reaches the broker without this step.
- **Holdings & performance** — live account state synced from the broker on a schedule, plus 30/90/180-day forward returns and alpha vs. SPY tracked against every past recommendation, not just the winners.
- **Research** — the full reasoning trail behind every proposal the agents have ever made, win or lose.
- **Agents** — each agent's mandate, strategy notes, and running track record, since the three agents run independently with different philosophies.
- **Investors** — a read-only view for people with money in the strategy, showing NAV, unit price, and performance without exposing operational internals.

## Execution worker

A separate process (`scripts/mac-companion.mjs`) runs on a machine outside this web app, polling for approved proposals and placing orders only after verifying the approval's signature. It's split out deliberately — a compromised or buggy web request can queue a proposal, but it cannot forge an execution.

## Stack

Next.js 16, Clerk auth, Vercel. Shares a Google Sheet (system of record) and Upstash Redis instance with the [backend](https://github.com/Kairos-Portfolio-Manager/portfolio-manager).
