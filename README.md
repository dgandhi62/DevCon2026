# AWS CDK — "Skip the wait"

DevCon 2026 booth demo. A small but real serverless app — a **live feedback
wall** — used to showcase four CDK speed capabilities in one iteration loop:

| Capability | Where it shows up |
| --- | --- |
| **synth-performance skill** (agentic) | Phase 1 — `lib/constructs/analytics.ts` |
| **Synth-time validation** (`@aws/cloudformation-validate`) | Phase 2 — `lib/phase2-broken-stack.ts` |
| **Hotswap** (`cdk deploy --hotswap`) | Phase 3 — `lambda/reactions/index.js` + `lib/constructs/api.ts` |
| **Express mode** (`cdk deploy --express`) | Phase 3 — `lib/constructs/website.ts` |

Docs:
- [`docs/OVERVIEW.md`](docs/OVERVIEW.md) — **start here**: the whole app, its intent, and how every piece fits
- [`docs/PLAN.md`](docs/PLAN.md) — full design
- [`docs/PRESENTER-SCRIPT.md`](docs/PRESENTER-SCRIPT.md) — on-stage flow
- [`docs/CHEAT-SHEET.md`](docs/CHEAT-SHEET.md) — the takeaway card
- [`docs/HOTSWAP.md`](docs/HOTSWAP.md) — ground-up reference for `--hotswap` (read before Phase 3a)
- [`docs/EXPRESS-MODE.md`](docs/EXPRESS-MODE.md) — ground-up reference for `--express` (read before Phase 3b)

## The app

Attendees open a URL, submit a one-line reaction to a session, and watch the
wall update with live vote counts.

```
Browser (S3 + CloudFront static site)
      │  fetch()
      ▼
API Gateway ──► Lambda (Node.js) ──► DynamoDB (reactions table)
```

## Stacks

| Stack | Purpose |
| --- | --- |
| `SkipTheWait-FeedbackWall` | The real, working app (DynamoDB + Lambda + API GW + S3/CloudFront) |
| `SkipTheWait-Phase2-Broken` | A public S3 bucket — synth-time validation fails on it when the guard is on |

## Setup

```bash
npm install
npm run build      # compile TypeScript -> JavaScript
npx cdk synth      # synthesize all stacks (no AWS account needed)
```

> **Node 22 note:** the app runs pre-compiled JS (`cdk.json` → `node bin/app.js`)
> rather than `ts-node`, which crashes on Node 22. Always `npm run build` (or
> `npm run watch`) before `cdk synth`.

## Running each phase

```bash
# Phase 1 — investigate slow synth (see docs/PRESENTER-SCRIPT.md for the skill)
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" npx cdk synth SkipTheWait-FeedbackWall > /dev/null

# Phase 2 — fail fast on a misconfiguration (toggle the guard in bin/app.ts)
npx cdk synth SkipTheWait-Phase2-Broken    # guard on: fails with validation report + construct path
                                           # guard off: same bucket synths clean (the "before")

# Phase 3 — fast deploys (run against your own account)
cdk deploy SkipTheWait-FeedbackWall --hotswap    # Lambda code change, seconds
cdk deploy SkipTheWait-FeedbackWall --express     # broader change, no stabilization wait
```

## Layout

```
bin/app.ts                     CDK app entry — wires the stacks
lib/constructs/database.ts     DynamoDB table
lib/constructs/api.ts          Lambda + API Gateway   (hotswap target)
lib/constructs/website.ts      S3 + CloudFront + deploy (express target)
lib/constructs/analytics.ts    Phase 1 slow construct  (duplicated-work bottleneck)
lib/feedback-wall-stack.ts     Composes the real app
lib/phase2-broken-stack.ts     Phase 2 misconfiguration (guard toggled in bin/app.ts)
lambda/reactions/index.js      API handler (hand-written JS)
frontend/                      Static site (index.html, styles.css, app.js)
.kiro/skills/                  cdk-synth-performance skill
docs/                          PLAN, PRESENTER-SCRIPT, CHEAT-SHEET
```
