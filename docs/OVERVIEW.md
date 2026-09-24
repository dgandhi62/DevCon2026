# The App & Its Intent — full context

The single doc that explains *what this is*, *why it exists*, and *how every
piece fits together*. If you read one thing before the booth, read this. The
other docs go deeper on individual pieces:

- `PLAN.md` — the original build plan
- `PRESENTER-SCRIPT.md` — the minute-by-minute on-stage flow
- `CHEAT-SHEET.md` — the takeaway card handed to attendees
- `HOTSWAP.md` / `EXPRESS-MODE.md` — ground-up references for the two deploy modes

---

## Live deployment (us-east-1, sandbox account 615368094448)

- **Feedback wall (site):** https://d10vcmdyjfal7.cloudfront.net
- **Reactions API:** https://jqpy0aksui.execute-api.us-east-1.amazonaws.com/prod/

These are generated at deploy time (the stack's `WallUrl` / `ApiUrl` outputs) —
they are not hard-coded in the app. If you redeploy to a fresh stack/account the
URLs change; re-check the `cdk deploy` outputs. Stack: `SkipTheWait-FeedbackWall`.

---

## 1. Why this exists

This is the DevCon 2026 booth demo for the submission **"AWS CDK — Skip the
wait."** The pitch: the AWS CDK CLI now has a suite of speed-focused
capabilities that collapse the infrastructure development loop from minutes to
seconds. Four of them, specifically:

1. **A synth-performance agentic skill** — pinpoints *why* a `cdk synth` is slow.
2. **Synth-time validation** — catches misconfigurations right after synth, on
   your laptop, before any deploy.
3. **Hotswap** (`cdk deploy --hotswap`) — bypasses CloudFormation for supported
   code changes, calling service APIs directly.
4. **Express mode** (`cdk deploy --express`) — deploys through CloudFormation but
   skips resource-stabilization waits, up to ~4x faster.

The **intent of the demo** is to make those four capabilities *felt*, not just
described. We do that by walking a real developer's iteration loop —
**author → synth → deploy → iterate** — and showing how each capability removes
the dead time at a specific stage of that loop.

The deeper message: this faster feedback loop helps **both human builders and AI
agents** iterate on infrastructure. Agents especially benefit — a tighter
synth/validate/deploy loop means an agent spends less wall-clock time waiting and
can course-correct sooner.

---

## 2. What we're trying to do at the table

Give an attendee a single, coherent story they can follow end to end in ~6–8
minutes, using an app that is **real and visibly changing on screen** the whole
time. Not four disconnected feature demos — one loop, with the waiting removed at
each step.

The takeaway they leave with (the cheat-sheet card): *which acceleration to reach
for at which stage of the loop.*

---

## 3. The app: CDK Booth Feedback Wall

We needed an app that is (a) genuinely functional, (b) visual, and (c) naturally
exercises all four capabilities. So the app is a **live feedback wall**:

> Attendees open a URL (QR code on the signage), pick a mood emoji, type a
> one-line reaction to the sessions, and post it. The wall shows every reaction
> as a card, most-upvoted first, and anyone can upvote. It polls and updates
> live.

It's thematically self-referential — the app is *about* the booth it's sitting
on — so every deploy we do at the table changes something the audience can see.

### Why this app fits the four capabilities

| Capability | What in the app exercises it |
| --- | --- |
| synth-performance skill | An optional "analytics" construct that's deliberately slow to synth |
| Synth-time validation | A deliberately-misconfigured S3 bucket (Phase 2 stacks) |
| Hotswap | The reactions Lambda — a code change with no build step |
| Express mode | The website/CloudFront/bucket infra — a broader, structural change |

---

## 4. Architecture

All serverless, all real:

```
        Browser
   (the feedback wall UI)
           │
           │  static site served by
           ▼
   Amazon CloudFront  ◄── origin access ──  Amazon S3 (private bucket)
           │                                    ▲
           │  fetch() to the API                │  static assets + config.js
           ▼                                    │  pushed by a BucketDeployment
   Amazon API Gateway (REST, proxy)
           │
           ▼
   AWS Lambda (Node.js, plain JS handler)
           │
           ▼
   Amazon DynamoDB (reactions table, on-demand)
```

**Request flow for a reaction:**

1. The static site (HTML/CSS/JS on S3+CloudFront) calls the API.
2. API Gateway proxies everything to one Lambda.
3. The Lambda routes internally and reads/writes DynamoDB.
4. The frontend polls `GET /reactions` every 5s and re-renders the wall.

**How the frontend finds the API:** at deploy time the `BucketDeployment` writes
a generated `config.js` (`window.FEEDBACK_API = "<api-url>"`) next to the static
files. If that's absent (opening the site locally, pre-deploy), the frontend
falls back to an in-memory **demo mode** with seeded reactions — so the wall
always looks alive, even with no AWS account.

---

## 5. The API contract

The Lambda (`lambda/reactions/index.js`) serves three routes; the frontend
(`frontend/app.js`) consumes exactly these:

| Method & path | Purpose | Returns |
| --- | --- | --- |
| `GET /reactions` | List all reactions, most-voted first | `{ reactions: [...] }` |
| `POST /reactions` | Create a reaction | `{ reaction: {...} }` |
| `POST /reactions/{id}/upvote` | Increment a reaction's votes | `{ reaction: {...} }` |

A reaction record:

```json
{ "id": "uuid", "name": "anon", "message": "…", "mood": "fire",
  "votes": 0, "createdAt": "ISO-8601" }
```

Valid moods: `fire`, `mind`, `love`, `think`, `rocket`. The handler validates
input (message required, length caps, mood allow-list), sets CORS headers (site
and API are different origins), and wraps everything in try/catch so an error
becomes a clean JSON 500 rather than an opaque API Gateway 502.

---

## 6. The stacks

Three CloudFormation stacks, all synthesizable offline (no AWS account needed to
`cdk synth`):

| Stack | What it is | Role in the demo |
| --- | --- | --- |
| `SkipTheWait-FeedbackWall` | The real, working app | The one stack — all three phases live in it; the deploy target for Phase 3 |

There's only one stack now — Phases 1, 2, and 3 all happen inside it. The
analytics construct (Phase 1's slow-synth bottleneck) is **ON by default**, so
`cdk synth SkipTheWait-FeedbackWall` is slow out of the box. Pass
`-c includeAnalytics=false` to drop it and see the fast baseline.

---

## 7. Every file, and why it's there

```
bin/
  app.ts                     CDK app entry. Instantiates the FeedbackWall stack.
                             Holds the Phase 2 policy-plugin toggle
                             (Validations.of(app).addPlugins(...)) — OFF by default.

lib/
  feedback-wall-stack.ts     Composes the real app from the constructs below.
                             Analytics is ON by default (Phase 1).

  constructs/
    database.ts              DynamoDB reactions table (on-demand billing).
    api.ts                   Lambda + API Gateway.        ← Phase 3a HOTSWAP target
    website.ts               S3 + CloudFront + BucketDeployment, injects config.js.
                             Holds the Phase 2 site-bucket validation toggle
                             AND the Phase 3b EXPRESS (CloudFront) toggle.
    analytics.ts             SessionAnalytics: renders the insight-report bundle
                             per session. Deliberately slow.  ← Phase 1 bottleneck
    analytics.config.json    Session catalog (the 3-day program) the construct reads.

assets/
  insight-templates/         ~600 report-template files. The Phase 1 bug re-reads
                             and re-renders this whole bundle once per session.

lambda/
  reactions/index.js         The API handler. Plain JS (no build step) so a code
                             edit can be hotswapped instantly. Holds the Phase 3a
                             API_VERSION toggle.

frontend/
  index.html                 The wall UI markup.
  styles.css                 Dark, booth-friendly styling (AWS orange / CDK blue).
  app.js                     Fetch + render + submit + upvote + poll. Demo-mode
                             fallback when no API is configured.
  config.js                  Placeholder; overwritten at deploy with the real
                             API URL.

rules/
  s3-block-public-access.guard   The single CFN-Guard rule the validator runs in
                                 Phase 2 (S3 bucket-level Block Public Access).

.kiro/skills/
  cdk-synth-performance.md   The agentic skill used in Phase 1 to find the
                             synth bottleneck.

docs/
  OVERVIEW.md                This file.
  PLAN.md, PRESENTER-SCRIPT.md, CHEAT-SHEET.md, HOTSWAP.md, EXPRESS-MODE.md
```

---

## 8. The three phases, in detail

### Phase 1 — "Where is my time going?" (authoring/synth)

**File:** `lib/constructs/analytics.ts`

The analytics construct powers the Session Insights panel (the second tab on the
wall). It works — but it's needlessly slow to synth, and the slowness is a
**duplicated-work** bug (not cross-stack refs, not sheer resource count):

- For **every** session, it calls `renderReportBundle()`, which reads and
  assembles **every file** in `assets/insight-templates/` (~600 files). The
  bundle never changes between sessions, so that whole read-and-render pass
  should happen **once**, not once per session.

In a CPU profile this shows up as Construction-phase time dominated by one
user-code function (`renderReportBundle` → `fs.readdirSync` / `fs.readFileSync`),
called N times with identical input. The **cdk-synth-performance skill** captures
the profile and points right at it.

**The fix:** hoist the render out of the loop (render once, reuse). Synth time
drops immediately. Analytics is on by default, so just:

```bash
cdk synth SkipTheWait-FeedbackWall
```

Measured contrast: slow ~15-18s vs fast baseline ~3-4s
(`-c includeAnalytics=false` drops the panel entirely).

### Phase 2 — "Fail fast, not after a 3-minute deploy" (synth)

**File:** `lib/constructs/website.ts` — the site bucket's three-state toggle. No
separate stack; the misconfiguration is in the real app's website bucket, and it
demonstrates **two validation layers**.

- **State A (built-in):** `publicReadAccess: true` with `blockPublicAccess` left
  at BLOCK_ALL. **CDK's own synth validation throws** — an inconsistent config,
  caught before any plugin:

  ```
  Cannot use 'publicReadAccess' property on a bucket without allowing bucket-level
  public access through 'blockPublicAccess' property.
  ```

- **State B (plugin):** "fixed" by also opening `blockPublicAccess`. CDK's
  built-in check now passes, but the bucket is genuinely public — so the
  **CFN-Guard policy plugin fails synth** with the rule + construct path:

  ```
  ERROR [CT.S3.PR.1]: Require an Amazon S3 bucket to have block public access settings configured
     SkipTheWait-FeedbackWall/Website/SiteBucket/Resource (...) aws-cdk-lib.aws_s3.CfnBucket
     Suggested fix: The parameters 'BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls',
     'RestrictPublicBuckets' must be set to true …
  ```

- **State C (locked, baseline):** BLOCK_ALL, no public read — passes both layers.

The **policy plugin is OFF by default** (baseline). You turn it ON in `bin/app.ts`
to demonstrate what it adds: with the bucket public (state B) and the plugin off,
synth passes; register the plugin and the same bucket fails on CT.S3.PR.1.

Two layers, both on your laptop, both before a deploy: CDK built-in catches the
structural mistake; the policy plugin catches the security policy CDK can't know
about.

### Phase 3 — "Quick deployments" (deploy)

**Files:** `lambda/reactions/index.js` (hotswap), `lib/constructs/website.ts`
(express)

- **Hotswap:** edit the Lambda handler, `cdk deploy --hotswap`. CDK skips
  CloudFormation and calls the Lambda API directly — seconds. See `HOTSWAP.md`.
- **Express:** make a broader infrastructure change, `cdk deploy --express`. Full
  CloudFormation deploy, but no stabilization waits. See `EXPRESS-MODE.md`.

Only this phase needs a real AWS account.

---

## 9. Key design decisions (and why)

- **TypeScript CDK + plain-JS Lambda handler.** The handler is deliberately *not*
  compiled/bundled so a code edit can be hotswapped with zero build step in
  between — critical for a snappy Phase 3a.
- **Compile TS → JS; `cdk.json` runs `node bin/app.js`.** Avoids running the app
  through `ts-node`, which crashes on Node 22. Always `npm run build` before
  synth.
- **Vanilla frontend (no framework).** Always runs, nothing to build, looks clean
  on a booth screen, and the demo-mode fallback keeps the wall alive with no
  backend.
- **Analytics behind a context flag.** The everyday app stays fast; the slow path
  is opt-in only for the Phase 1 walkthrough.
- **Validation scoped to ONE rule.** The full Control Tower rule set flags ~24
  findings on the app and would also fail the "fixed" stack. We copied just the
  S3 public-access rule into `rules/` so Phase 2 tells a single clean story. Drop
  `controlTowerRulesEnabled: false` in `bin/app.ts` to run the full set.
- **On-demand DynamoDB, DESTROY removal policies.** Zero capacity planning and a
  clean teardown after the event.

---

## 10. Important caveat about "synth-time validation"

The submission describes a built-in `@aws/cloudformation-validate` plugin that
runs automatically. In the **current public `aws-cdk-lib`**, that plugin is not
auto-wired. To make Phase 2 actually fail *today*, this repo registers the
publicly-available `@cdklabs/cdk-validator-cfnguard` plugin in `bin/app.ts`
(scoped to the one S3 rule). The developer experience — synth fails, prints the
rule + construct path — is identical. If the built-in ships before the event,
swap the plugin registration out and the phase behaves the same.

---

## 11. How to run it

```bash
npm install
npm run build        # compile TS -> JS (before every synth session)

# Phase 1 — slow synth + skill investigation (analytics ON by default)
cdk synth SkipTheWait-FeedbackWall
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" \
  cdk synth SkipTheWait-FeedbackWall > /dev/null
# fast baseline for contrast:  cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=false

# Phase 2 — fail fast (toggle the site bucket in lib/constructs/website.ts)
#   state A -> CDK built-in throws;  state B -> plugin fails CT.S3.PR.1;  state C -> passes both
cdk synth SkipTheWait-FeedbackWall

# See the wall with no AWS account (demo mode)
open frontend/index.html

# Phase 3 — needs an AWS account (see HOTSWAP.md / EXPRESS-MODE.md)
cdk deploy SkipTheWait-FeedbackWall --hotswap
cdk deploy SkipTheWait-FeedbackWall --express
```

---

## 12. The through-line (say this)

> Every CDK developer runs the same loop: author → synth → deploy → repeat, with
> dead time at each step. The synth-performance skill tells you where synth time
> goes. Synth-time validation fails you fast, on your laptop, before a wasted
> deploy. Hotswap skips CloudFormation for code changes. Express mode skips the
> stabilization wait for everything else. Same loop you run every day — minus the
> waiting. And that helps agents just as much as people.
