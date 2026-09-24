# Presenter Script — "AWS CDK: Skip the wait"

DevCon 2026 booth. One iteration loop, three phases. Total run time ~6–8 min;
each phase stands alone if someone joins mid-way.

**Before the shift starts:**

```bash
npm install
npm run build          # compile TS -> JS (needed before every synth session)
```

Have two things open: a terminal, and the feedback wall in a browser
(`frontend/index.html` opens straight in demo mode, or the CloudFront URL if
you've deployed).

**No live coding.** Every change in this demo is a pre-written toggle. In each
file, find the `DEMO TOGGLE — PHASE N` banner and comment one block / uncomment
the other. You never write code at the table.

| Phase | File with the toggle | Flip | What the flip proves |
| --- | --- | --- | --- |
| 1 | `lib/constructs/analytics.ts` | SLOW ↔ FAST | the skill found the real bottleneck |
| 2 | `lib/constructs/website.ts` (bucket) + `bin/app.ts` (plugin OFF→ON) | A built-in throws → B public+plugin ON fails | two synth-time validation layers catch a public bucket |
| 3a | `lambda/reactions/index.js` | V1 ↔ V2 (`API_VERSION`) | code-only → hotswap used; **badge flips live on the wall** |
| 3b | `lib/constructs/website.ts` (CloudFront) | V1 ↔ V2 (`errorResponses`) | CFN CloudFront change → express skips the stabilization wait |

After a `.ts` toggle, run `npm run build`. (The Lambda toggle is plain JS — no
build.)

**Resetting between runs:**
- Local code only (no deploys) → `npm run reset`, then `npm test` (expect 43/43).
- If you deployed Phase 3 (hotswap/express) → `npm run reset:deploy` (resets code
  AND restores the live stack + Lambda), then `npm test`.

---

## Opening (30 seconds)

> "Every CDK developer lives the same loop: author → synth → deploy → repeat.
> Each step has dead time. Synth that drags, deploys that fail three minutes in,
> CloudFormation waits you sit through. We've been cutting that dead time out.
> Let me show you one loop with the waiting removed."

Point at the wall on screen: "This is a real app — reactions from this very
booth. We're going to change it live."

---

## Phase 1 — "Where is my time going?" (2 min)

**File to open:** `lib/constructs/analytics.ts`

**Setup line:**

> "This app has a Session Insights panel — the second tab on the wall. It's part
> of the app, and my synth has gotten painfully slow. Watch."

**Run the synth** (analytics is baked into the base app — no flag needed):

```bash
time npx cdk synth SkipTheWait-FeedbackWall > /dev/null
```

Let them see the wall-clock seconds (~15-18s).

**Now bring in the skill.** In Kiro (or your agent of choice), the
`cdk-synth-performance` skill is in `.kiro/skills/`. Ask:

> "My synth is slow. Investigate where the time is going."

The skill captures a CPU profile and reports back. The finding it should land
on:

- Construction phase dominates.
- One user-code function — `renderReportBundle()` in
  `lib/constructs/analytics.ts` — accounts for most of the time.
- It reads and assembles the entire `assets/insight-templates/` bundle
  (`fs.readdirSync` + `fs.readFileSync` over every file), and it's called once
  **per session** — the same bundle, re-read and re-rendered every time.

**The talking point:**

> "It's not that CDK is slow. It's that my code re-reads and re-renders the same
> template bundle for every session — dozens of times — when the bundle never
> changes. The skill didn't guess; it profiled it and pointed at the function."

**The fix, live — no typing.** In `lib/constructs/analytics.ts` find the
`DEMO TOGGLE — PHASE 1` banner. Two blocks: **SLOW** (active) renders the bundle
per session; **FAST** (commented) renders it once before the loop and reuses it.
Comment the SLOW block, uncomment the FAST block. Then:

```bash
npm run build      # recompile TS -> JS (toggles live in .ts)
time npx cdk synth SkipTheWait-FeedbackWall > /dev/null
```

**Re-run** the timed synth — it drops from ~15-18s to ~3-4s.

> "Same panel. The waiting is gone."

> **Note for the presenter:** flipping the toggle is optional theatre — the real
> point is the *skill found it*. If you do flip it, remember `npm run build`
> before the re-synth, and `npm run reset` afterward to restore the baseline.
> (To show the fast baseline directly, `-c includeAnalytics=false` drops the
> panel entirely.)

---

## Phase 2 — "Fail fast, not after a 3-minute deploy" (2 min)

The misconfiguration lives in the **real app's website bucket** — no separate
stack. It shows **two validation layers**: CDK's own built-in synth validation
(always on), then the policy plugin (off by default — you turn it on to prove
what it adds). Baseline: bucket **C (locked)**, plugin **OFF**.

**Files to open:** `lib/constructs/website.ts` (the `DEMO TOGGLE — PHASE 2`
bucket states A / B / C) and `bin/app.ts` (the `DEMO TOGGLE — PHASE 2` plugin
on/off block).

**Setup line:**

> "I want to serve some files straight from the site bucket, so I make it public.
> Classic mistake. Watch how far it gets."

### Layer 1 — CDK's built-in synth validation (state A)

Comment state C, uncomment **state A** (`publicReadAccess: true`, but
`blockPublicAccess` left at BLOCK_ALL). Then:

```bash
npm run build
npx cdk synth SkipTheWait-FeedbackWall     # FAILS — CDK itself throws
```

CDK's **own** validation rejects it at synth (no plugin involved):

```
Cannot use 'publicReadAccess' property on a bucket without allowing bucket-level
public access through 'blockPublicAccess' property.
```

> "That's CDK's built-in validation — it caught an inconsistent config before
> any plugin, before any deploy. Free, on my laptop, instantly."

### Layer 2 — the policy validation plugin (state B + turn the plugin ON)

Now "fix" it the wrong way: comment state A, uncomment **state B** — which ALSO
opens `blockPublicAccess`. Now CDK's built-in check is satisfied... but the
bucket is genuinely public. Synth it and note it **passes** — the plugin is off
by default, so nothing catches the security problem:

```bash
npm run build
npx cdk synth SkipTheWait-FeedbackWall     # PASSES — a deploy would ship a public bucket
```

> "CDK's built-in validation is happy now — the config is consistent. But this
> bucket is wide open, and a plain deploy would ship it. I need a security
> policy check. Let me turn one on."

**Now register the guard.** In `bin/app.ts`, find the `DEMO TOGGLE — PHASE 2`
banner and uncomment the **PLUGIN ON** block (`Validations.of(app).addPlugins(
new CfnGuardValidator(...))`). Re-synth the same app:

```bash
npm run build
npx cdk synth SkipTheWait-FeedbackWall     # now FAILS on the policy plugin
```

The CFN-Guard policy plugin fails synth with the rule and the construct path:

```
ERROR [CT.S3.PR.1]: Require an Amazon S3 bucket to have block public access settings configured
   SkipTheWait-FeedbackWall/Website/SiteBucket/Resource (...) aws-cdk-lib.aws_s3.CfnBucket
   Suggested fix: The parameters 'BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls',
   'RestrictPublicBuckets' must be set to true under the bucket-level 'PublicAccessBlockConfiguration'.
```

**The talking point (this is the proof):**

> "Two layers caught this before a deploy. CDK's built-in validation caught the
> structural mistake. Then the policy plugin caught the security problem CDK
> can't know about — a genuinely public bucket — with the exact rule and
> construct path. All on my laptop, in one second, not three minutes into a
> deploy or in prod."

### The real fix (state C)

Lock the bucket back down: comment state B, uncomment **state C** (`BLOCK_ALL`,
no public read). Leave the plugin ON — now it passes, proving the fix is good.
Then `npm run build && npx cdk synth SkipTheWait-FeedbackWall` passes both layers.

> (Note: `npm run reset` returns to baseline — bucket **C locked** AND plugin
> **OFF**. So the plugin you turned on gets switched back off on reset.)

> **Under the hood:** the plugin is `@cdklabs/cdk-validator-cfnguard`, registered
> via `Validations.of(app).addPlugins(...)` in `bin/app.ts`, scoped to the single
> S3 public-access rule (`rules/s3-block-public-access.guard`) for one clean
> finding.

> **Say the bigger capability:** the same plugin ships the full **Control Tower
> proactive security controls** — dozens of managed rules (encryption, versioning,
> access logging, SSL-only, public-access, and more) across many resource types.
> Drop `controlTowerRulesEnabled: false` in `bin/app.ts` to run the whole managed
> security ruleset at synth. You can also add CDK Nag, OPA, or your org's own
> CFN-Guard rules the same way — a pluggable, shift-left security gate that runs
> before anything leaves your laptop.

> **Reset:** baseline is bucket state **C (locked)** + plugin **OFF**.
> `npm run reset` restores both.

---

## Phase 3 — "Quick deployments" (2–3 min, needs an AWS account)

> Only run the actual deploys if you're at a booth with credentials. Otherwise
> narrate it against the synthesized output.

### 3a. Hotswap — a Lambda code change (VISIBLE on the wall)

**File to open:** `lambda/reactions/index.js`. Have the wall on screen — look at
the **`api:` badge** in the top-right header. It reads `api: v1`.

**Setup line:**

> "The app's live. I want to ship a change to the API. Watch the version badge
> in the corner — and watch how fast this deploys."

**No typing.** Find the `DEMO TOGGLE — PHASE 3a` banner (top of the file).
Comment **V1**, uncomment **V2** — that's the one-line `API_VERSION` change. The
handler is plain JS, so no build step.

**Deploy with hotswap:**

```bash
cdk deploy SkipTheWait-FeedbackWall --hotswap --require-approval never
```

**Proof #1 — the CLI shows it hotswapped.** You'll see something like:

```
✨  hotswapping resources:
   └ AWS::Lambda::Function 'SkipTheWait-FeedbackWall-ApiHandler...'
✨  Deployment time: ~2s
```

No changeset. No `CREATE_/UPDATE_` CloudFormation events. Done in seconds.

**Proof #2 — the wall updates itself.** Within one poll (~5s) the header badge
flips to **`api: v2 · hotswapped 🔥`** and flashes. No page reload — the running
Lambda is simply new.

> "CDK saw the only change was Lambda code, so it skipped CloudFormation and
> called the Lambda UpdateFunctionCode API directly. Two seconds — and the
> running app changed in front of you, no CloudFormation involved."

**The pros (say these):** tightest possible edit → running-code loop; no
CloudFormation round-trip; ideal while you're actively developing.

**The cons — invite the conversation (say these):**

> "The trade is honest: hotswap deliberately **introduces drift** — the live
> function no longer matches what CloudFormation thinks is deployed. There's
> **no rollback**, it only works for a **limited set of resource types**, and
> for those reasons it's **development-only — never production.** It's a
> dev-loop accelerator, not a deployment strategy."

> **Optional strongest contrast:** revert to V1 and redeploy with a plain
> `cdk deploy` (no `--hotswap`). It builds a changeset, streams CloudFormation
> events, and takes far longer. Same change, side by side — that's the point.

> **Resetting after a hotswap (IMPORTANT):** hotswap changes the *running*
> Lambda but not CloudFormation's record, so flipping the code back to V1 and
> running a normal `cdk deploy` reports "no changes" and leaves the live
> function stuck on V2. Do NOT rely on `cdk deploy` / `--force` / `--revert-drift`
> to undo it. Instead run **`npm run reset:deploy`** — it resets the code AND
> force-pushes the V1 baseline straight to the running function (via
> UpdateFunctionCode), so the badge returns to `api: v1` every time. `npm run
> reset` only resets local code; `reset:deploy` also fixes the deployed Lambda.

### 3b. Express mode — a broader infrastructure change

**File to open:** `lib/constructs/website.ts`

**Setup line:**

> "Hotswap was a code change. This one is real infrastructure — a CloudFront
> setting. Hotswap can't touch it; it has to go through CloudFormation. The pain
> with CloudFront is the stabilization wait — normally the deploy sits there
> while the distribution re-propagates. Watch the terminal for that wait."

This one's proof is in the **terminal** (the skipped wait), not on the wall —
it's a config change, not a visible content change. That's the natural contrast
with the hotswap phase, where the change showed up on screen.

**No typing.** Find the `DEMO TOGGLE — PHASE 3b` banner. Comment **V1**,
uncomment **V2** (V2 adds SPA-style `errorResponses` to the CloudFront
distribution — a genuine template change, **not** hotswappable). Then:

```bash
npm run build
cdk deploy SkipTheWait-FeedbackWall --express --require-approval never
```

It deploys through CloudFormation (it's a real template change), but reports
complete as soon as the config is applied — instead of blocking on CloudFront's
stabilization/propagation.

> **Don't demo `--hotswap` here to "prove" it can't do this.** Plain `--hotswap`
> doesn't announce that it declined — it silently skips the change and prints
> `✅ (no changes)`, which looks like a no-op, not a lesson. Just say hotswap
> doesn't apply to infrastructure changes and move on.

> "Hotswap can't touch this — it's a real CloudFront change, so it has to go
> through CloudFormation. But with `--express`, CloudFormation reports done as
> soon as the config is applied instead of making me wait for the distribution
> to fully re-propagate. That wait is exactly what express removes."

> **Strongest proof (timing contrast):** deploy V2 once with a normal
> `cdk deploy` and note the time, then revert and redeploy with `--express`. The
> express run returns markedly faster because it skips the stabilization wait.

> **Say the caveat:** express doesn't wait for stabilization and won't
> auto-rollback unless you add `--rollback`. Dev iteration, not production.

---

## Takeaway (30 seconds)

Hand them the cheat-sheet card (`docs/CHEAT-SHEET.md`).

> "Four tools, one loop. The skill finds where synth time goes. Synth validation
> fails you fast, on your laptop. Hotswap skips CloudFormation for code changes.
> Express mode skips the stabilization wait for everything else. Same app you
> build every day — minus the waiting."

---

## Quick command reference

```bash
# Before each demo: confirm baseline (all toggles on their default side)
npm test                                    # expect 43/43, "Ground state is GOOD"

# Phase 1 — slow synth + investigation (analytics is ON by default)
time npx cdk synth SkipTheWait-FeedbackWall > /dev/null
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" npx cdk synth SkipTheWait-FeedbackWall > /dev/null
# (flip SLOW->FAST toggle in analytics.ts, then:)  npm run build && <re-run synth>
# fast baseline for contrast:  npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=false

# Phase 2 — fail fast (toggle the site bucket in website.ts: C locked / A built-in / B plugin)
npm run build && npx cdk synth SkipTheWait-FeedbackWall     # state A -> CDK built-in throws
npm run build && npx cdk synth SkipTheWait-FeedbackWall     # state B -> plugin fails CT.S3.PR.1
npm run build && npx cdk synth SkipTheWait-FeedbackWall     # state C (baseline) -> passes both

# Phase 3 — fast deploys (needs an account)
# (flip V1->V2 in lambda/reactions/index.js, then:)
cdk deploy SkipTheWait-FeedbackWall --hotswap --require-approval never
# (flip V1->V2 in website.ts, then:)  npm run build &&
cdk deploy SkipTheWait-FeedbackWall --express --require-approval never
cdk deploy SkipTheWait-FeedbackWall --express --rollback   # express + auto-rollback

# After a run:
#  - local code only (no deploys done):   restore toggles to baseline
npm run reset && npm test
#  - if you DEPLOYED Phase 3 (hotswap/express): also restore the LIVE stack.
#    This force-pushes the V1 baseline Lambda so the badge returns to api: v1
#    (a plain redeploy can't — hotswap drift is invisible to CloudFormation).
npm run reset:deploy
```
