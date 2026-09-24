# The App & Its Intent — full context

The single doc that explains *what this is*, *why it exists*, and *how every
piece fits together*. If you read one thing before the booth, read this. The
other docs go deeper on individual pieces:

- `PLAN.md` — the original build plan
- `PRESENTER-SCRIPT.md` — the minute-by-minute on-stage flow
- `CHEAT-SHEET.md` — the takeaway card handed to attendees
- `HOTSWAP.md` / `EXPRESS-MODE.md` — ground-up references for the two deploy modes

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
| `SkipTheWait-FeedbackWall` | The real, working app | The thing on screen; the deploy target for Phase 3 |
| `SkipTheWait-Phase2-Broken` | A public S3 bucket | Phase 2 — synth-time validation FAILS on it when the guard is on |

The `FeedbackWall` stack has an opt-in `includeAnalytics` flag (a CDK context
value) that adds the slow analytics construct for Phase 1. Off by default so the
everyday app synthesizes fast.

---

## 7. Every file, and why it's there

```
bin/
  app.ts                     CDK app entry. Instantiates the 3 stacks and
                             registers the synth-time validation plugin
                             (Validations.of(app).addPlugins(...)).

lib/
  feedback-wall-stack.ts     Composes the real app from the constructs below.
                             Holds the includeAnalytics toggle for Phase 1.
  phase2-broken-stack.ts     Phase 2: an S3 bucket with public access turned on
                             (always broken; the guard in bin/app.ts is toggled).

  constructs/
    database.ts              DynamoDB reactions table (on-demand billing).
    api.ts                   Lambda + API Gateway.        ← Phase 3 HOTSWAP target
    website.ts               S3 + CloudFront + BucketDeployment,
                             injects config.js with the API URL.
                                                          ← Phase 3 EXPRESS target
    analytics.ts             SessionAnalytics: a CloudWatch dashboard built in a
                             loop. Deliberately slow.     ← Phase 1 bottleneck
    analytics.config.json    Session catalog the analytics construct reads. The
                             Phase 1 bug re-reads + re-hashes this every loop.

lambda/
  reactions/index.js         The API handler. Plain JS (no build step) so a code
                             edit can be hotswapped instantly.

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

The analytics construct builds one row of CloudWatch widgets per conference
session. It works — but it's needlessly slow to synth, and the slowness is a
**duplicated-work** bug (not cross-stack refs, not sheer resource count):

- For **every** session, it re-reads `analytics.config.json` from disk, re-parses
  it, and re-computes an expensive PBKDF2 hash over the **entire file**. The
  input never changes, so that work should happen **once**, not once per session.

In a CPU profile this shows up as Construction-phase time dominated by one
user-code function (`hashConfig` / `buildSessionFingerprint`), called N times
with identical input. The **cdk-synth-performance skill** captures the profile
and points right at it.

**The fix:** hoist the read + parse + hash out of the loop (compute once, reuse).
Synth time drops immediately. Turn the slow path on with:

```bash
cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true
```

Measured contrast: fast synth ~3.4s vs slow ~5.6s (tunable via the construct's
`hashRounds`).

### Phase 2 — "Fail fast, not after a 3-minute deploy" (synth)

**Files:** `lib/phase2-broken-stack.ts` (always broken) + the guard toggle in
`bin/app.ts`.

The broken stack creates an S3 bucket with Block Public Access turned **off** and
public read granted. It synthesizes into perfectly valid CloudFormation — which
is the whole point: a plain deploy would have accepted it. The demo toggles the
**validation guard** in `bin/app.ts`, not the bucket:

- **Guard OFF** → `cdk synth SkipTheWait-Phase2-Broken` succeeds — the bad bucket
  slips through, just like a plain deploy would ship it. The "before".
- **Guard ON** → the same stack fails synth immediately:

```
ERROR [CT.S3.PR.1]: Require an Amazon S3 bucket to have block public access settings configured
   SkipTheWait-Phase2-Broken/PublicAssets/Resource (PublicAssetsACF28B1B)
   Suggested fix: The parameters 'BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls',
   'RestrictPublicBuckets' must be set to true …
```

You get the failing rule, the **construct path**, and a fix — on your laptop, in
one second. Same bucket, only the guard moved — so the guard is provably what
caught it.

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

# Phase 1 — slow synth + skill investigation
cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" \
  cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null

# Phase 2 — fail fast (toggle the guard in bin/app.ts)
cdk synth SkipTheWait-Phase2-Broken     # guard ON: FAILS CT.S3.PR.1 + path; guard OFF: passes

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
