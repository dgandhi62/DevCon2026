# AWS IAC: Skip the pain

DevCon 2026 booth demo. A small but real serverless app — a **live feedback
wall** — used to showcase four CDK speed capabilities in one iteration loop:

| Capability | Where it shows up |
| --- | --- |
| **synth-performance skill** (agentic) | Phase 1 — `lib/constructs/analytics.ts` |
| **Synth-time validation** (CDK built-in + `@cdklabs/cdk-validator-cfnguard` plugin) | Phase 2 — `lib/constructs/website.ts` (site bucket) |
| **Hotswap** (`cdk deploy --hotswap`) | Phase 3 — `lambda/reactions/index.js` + `lib/constructs/api.ts` |
| **Express mode** (`cdk deploy --express`) | Phase 3 — `lib/constructs/website.ts` (CloudFront) |

Docs:
- [`docs/OVERVIEW.md`](docs/OVERVIEW.md) — **start here**: the whole app, its intent, and how every piece fits
- [`docs/PLAN.md`](docs/PLAN.md) — full design
- [`docs/PRESENTER-SCRIPT.md`](docs/PRESENTER-SCRIPT.md) — on-stage flow
- [`docs/CHEAT-SHEET.md`](docs/CHEAT-SHEET.md) — the takeaway card
- [`docs/HOTSWAP.md`](docs/HOTSWAP.md) — ground-up reference for `--hotswap` (read before Phase 3a)
- [`docs/EXPRESS-MODE.md`](docs/EXPRESS-MODE.md) — ground-up reference for `--express` (read before Phase 3b)

## Live deployment

- **Feedback wall:** https://d10vcmdyjfal7.cloudfront.net
- **Reactions API:** https://jqpy0aksui.execute-api.us-east-1.amazonaws.com/prod/

Stack `SkipTheWait-FeedbackWall` in us-east-1 (sandbox account). URLs come
from the `cdk deploy` outputs (`WallUrl` / `ApiUrl`) — they change if you deploy
a fresh stack.

## The app

Attendees open a URL, submit a one-line reaction to a session, and watch the
wall update with live vote counts.

```
Browser (S3 + CloudFront static site)
      │  fetch()
      ▼
API Gateway ──► Lambda (Node.js) ──► DynamoDB (reactions table)
```

## Stack

One stack holds the whole demo — all three phases live in it:

| Stack | Purpose |
| --- | --- |
| `SkipTheWait-FeedbackWall` | The real, working app (DynamoDB + Lambda + API GW + S3/CloudFront). Phase 1 (slow synth), Phase 2 (website-bucket validation toggle), and Phase 3 (hotswap/express) all live here. |

## Setup

```bash
npm install
npm run build      # compile TypeScript -> JavaScript
npx cdk synth SkipTheWait-FeedbackWall   # synthesize (no AWS account needed)
```

> **Node 22 note:** the app runs pre-compiled JS (`cdk.json` → `node bin/app.js`)
> rather than `ts-node`, which crashes on Node 22. Always `npm run build` (or
> `npm run watch`) before `cdk synth`.

## Running each phase

```bash
# Phase 1 — investigate slow synth (analytics is ON by default; see PRESENTER-SCRIPT for the skill)
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" npx cdk synth SkipTheWait-FeedbackWall > /dev/null
# fast baseline for contrast:  npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=false

# Phase 2 — fail fast (toggle the site bucket in lib/constructs/website.ts)
#   state A -> CDK built-in validation throws;  state B -> plugin fails CT.S3.PR.1;  state C -> passes
npx cdk synth SkipTheWait-FeedbackWall

# Phase 3 — fast deploys (run against your own account)
cdk deploy SkipTheWait-FeedbackWall --hotswap    # Lambda code change, seconds
cdk deploy SkipTheWait-FeedbackWall --express     # broader change, no stabilization wait
```

## Layout

```
bin/app.ts                     CDK app entry — wires the stacks
lib/constructs/database.ts     DynamoDB table
lib/constructs/api.ts          Lambda + API Gateway   (hotswap target)
lib/constructs/website.ts      S3 + CloudFront + deploy (Phase 2 bucket toggle + Phase 3b express target)
lib/constructs/analytics.ts    Phase 1 slow construct  (per-session template-render bottleneck)
lib/feedback-wall-stack.ts     Composes the real app (analytics ON by default)
lambda/reactions/index.js      API handler (hand-written JS; Phase 3a hotswap target)
assets/insight-templates/      Report-template bundle the analytics construct renders at synth
frontend/                      Static site (index.html, styles.css, app.js)
rules/                         CFN-Guard rule for Phase 2 validation
scripts/reset-deploy.js        Full baseline restore (code + live stack + Lambda)
.kiro/skills/                  cdk-synth-performance skill
docs/                          OVERVIEW, PLAN, PRESENTER-SCRIPT, CHEAT-SHEET, HOTSWAP, EXPRESS-MODE
```
