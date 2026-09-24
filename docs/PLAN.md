# AWS CDK — "Skip the wait" · DevCon 2026 Demo Plan

This document is the build plan and single source of truth for the demo. It
describes the app we are building, why it fits, the repo layout, and how each
CDK speed capability maps to a specific file and a specific moment on stage.

---

## The submission (for reference)

> **AWS CDK - Skip the wait**
>
> The AWS CDK CLI now accelerates infrastructure development cycles from minutes
> to seconds through a new suite of speed-focused capabilities. `cdk validate`
> catches misconfigurations before they ever leave a user's local machine,
> `--hotswap` bypasses CloudFormation to enable close speed parity with the SDKs
> for supported AWS resources, `cdk` express mode allows users to deploy
> CloudFormation stacks up to 4x faster, and a brand new `cdk` agentic skill
> pinpoints synthesis bottlenecks efficiently.

The four capabilities being showcased:

| Capability | What it is | CLI surface |
| --- | --- | --- |
| **synth-performance skill** | Agentic skill that captures a CPU profile of a `cdk synth` and pinpoints the constructs/lines that dominate synth time | `.kiro/skills/cdk-synth-performance.md` |
| **Synth-time validation** | Built-in `@aws/cloudformation-validate` plugin runs right after synth, fails fast on misconfigurations, prints the rule + construct path | `cdk synth` (automatic) |
| **Hotswap** | Bypasses CloudFormation, calls service APIs directly for supported changes (e.g. Lambda code) | `cdk deploy --hotswap` |
| **Express mode** | Deploys through CloudFormation but reports completion as soon as config is applied — skips stabilization waits, up to ~4x faster | `cdk deploy --express` |

---

## The app: "CDK Booth Feedback Wall"

A small but genuinely functional app. Attendees at the DevCon table open a URL
(QR code on the signage), submit a one-line reaction to a talk/session, and see
the wall of reactions update live with vote counts.

It is real (API + database + static frontend), it is visual (a live-updating
card wall), and it is thematically on-point: the app is *about* the booth, so
every deploy we do at the table changes something attendees can see on screen.

### Why this app fits the demo

- It has a **Lambda we edit** → ideal for `--hotswap` (change the response, see
  it live in seconds).
- It has **broader infra** (DynamoDB, S3 + CloudFront frontend, API Gateway) →
  ideal for `--express` (full-stack deploy without stabilization waits).
- The **frontend** keeps something on screen the whole time, so the audience
  sees the payoff of each fast deploy.

### Architecture (all serverless, all real)

```
Browser (static site: S3 + CloudFront)
      │  fetch()
      ▼
API Gateway ──► Lambda (Node.js handler) ──► DynamoDB (reactions table)
```

---

## Repo layout — organized so we demo feature-by-feature

Each CDK capability lives in its own file, so on stage we open exactly one file
per phase instead of scrolling one giant stack.

```
DevCon2026/
├── README.md                     # what it is + how to run each phase
├── package.json, tsconfig.json, cdk.json, .gitignore
│
├── bin/
│   └── app.ts                    # wires the stacks together
│
├── lib/
│   ├── constructs/
│   │   ├── database.ts           # DynamoDB table (own file)
│   │   ├── api.ts                # Lambda + API Gateway  ← Phase 3 hotswap target
│   │   ├── website.ts            # S3 + CloudFront + BucketDeployment ← Phase 3 express target
│   │   └── analytics.ts          # ← Phase 1 lives here: the SLOW construct
│   │
│   ├── feedback-wall-stack.ts    # the real, working app (composes the above)
│   └── phase2-broken-stack.ts    # Phase 2: misconfig that validation catches
│
├── lambda/
│   └── reactions/
│       └── index.js              # the API handler (edit this for hotswap demo)
│
├── frontend/
│   ├── index.html                # the feedback wall UI
│   ├── styles.css                # clean, dark, booth-friendly
│   └── app.js                    # fetch + render + submit
│
├── .kiro/skills/
│   └── cdk-synth-performance.md  # the agentic skill
│
└── docs/
    ├── PLAN.md                   # this document
    ├── PRESENTER-SCRIPT.md       # per-phase talking points + exact commands
    └── CHEAT-SHEET.md            # the takeaway card (authoring→synth→deploy→iterate)
```

---

## The three phases mapped to files

### Phase 1 — "Where is my time going?" → `lib/constructs/analytics.ts`

An optional "analytics" construct the app composes in. Its bottleneck is
**duplicated work** — not cross-stack references.

Concretely: it reads and parses the **same** file (and re-hashes the same data)
**once per item inside a loop**, instead of doing it once. The synth-performance
skill's CPU profile will show that duplicated function dominating construction
time and point at the exact lines.

- **The tell in the profile:** a single user-code function (the parse/hash
  helper) accounts for most construction samples, called N times with identical
  input.
- **The fix (shown live):** hoist the read/parse/hash out of the loop (or
  memoize it) so it runs once. Synth time drops immediately — a satisfying
  one-line change.

### Phase 2 — "Fail fast, not after a 3-minute deploy" → `phase2-broken-stack.ts`

A publicly-open S3 bucket: block-public-access turned off + public read access.
It synthesizes into perfectly valid CloudFormation — which is exactly why a
plain deploy used to let it through and you only found out minutes into the
deploy (or in prod).

- **What happens:** `cdk synth SkipTheWait-Phase2-Broken` runs the built-in
  `@aws/cloudformation-validate` plugin right after synth. Synth **fails**, and
  the validation report prints the failing rule and the **construct path** to
  the bucket.
- **The fix (shown live):** toggle the validation guard in `bin/app.ts` on/off
  to show that the guard is what catches the (unchanged) bad bucket.

### Phase 3 — "Quick deployments" → `lib/constructs/api.ts` + `lib/constructs/website.ts`

- **Hotswap:** edit `lambda/reactions/index.js` (e.g. change how a reaction is
  formatted / add an emoji), then `cdk deploy --hotswap`. CDK calls the Lambda
  `UpdateFunctionCode` API directly — seconds, not a CloudFormation cycle. The
  live wall reflects the change.
- **Express:** make a broader change (e.g. add a resource/field), then
  `cdk deploy --express`. Full stack through CloudFormation, but without
  stabilization waits.

### Takeaway → `docs/CHEAT-SHEET.md`

A card showing which acceleration technique to reach for at each stage of the
dev cycle: **authoring → synth → deploy → iterate**.

---

## Build decisions

- **Language:** TypeScript CDK + a plain JavaScript Lambda handler, so hotswap
  edits are trivial to show (no build step between edit and deploy). Frontend is
  vanilla HTML/CSS/JS — no framework, always runs, looks clean.
- **Node 22 gotcha:** compile TS → JS and point `cdk.json` at `node bin/app.js`
  to avoid the `ts-node` crash observed on Node 22.
- **Runnable offline:** everything `cdk synth`s without AWS credentials. Only
  Phase 3 actually deploys, done against your own account.

---

## Build order (tracked in the task list)

1. Scaffold: `package.json`, `tsconfig.json`, `cdk.json`, `.gitignore`, README,
   copy in the synth-performance skill.
2. Frontend: `index.html`, `styles.css`, `app.js` (the feedback wall UI).
3. Lambda handler: `lambda/reactions/index.js` (GET list + POST reaction, DynamoDB).
4. Constructs: `database.ts`, `api.ts`, `website.ts`, then `feedback-wall-stack.ts`.
5. Phase 1 slow construct: `analytics.ts` (duplicated-work bottleneck).
6. Phase 2: `phase2-broken-stack.ts` + the validation guard toggle in `bin/app.ts`.
7. Wire `bin/app.ts`.
8. Docs: `PRESENTER-SCRIPT.md`, `CHEAT-SHEET.md`.
9. Verify: `npm install`, `tsc`, `cdk synth` each stack; confirm Phase 2
   validation fails on broken and passes on fixed.

---

## Demo flow at the table (one iteration loop)

1. **Show the working app.** The feedback wall is live on screen; a few
   reactions already on it.
2. **Phase 1.** "Synth got slow." Run the skill → it names the duplicated-work
   function and lines in `analytics.ts`. Apply the one-line fix → synth is fast.
3. **Phase 2.** "Now I make a change with a mistake." Synth the broken stack →
   validation fails fast with the construct path. Fix it → synth passes.
4. **Phase 3.** "Ship it." Edit the Lambda → `--hotswap` → wall updates in
   seconds. Make a broader change → `--express` → full stack, no stabilization
   wait.
5. **Takeaway.** Hand them the cheat-sheet card.
