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
| 2 | `bin/app.ts` | GUARD OFF ↔ ON | the guard is what catches the bad bucket |
| 3a | `lambda/reactions/index.js` | V1 ↔ V2 (`API_VERSION`) | code-only → hotswap used; **badge flips live on the wall** |
| 3b | `lib/constructs/website.ts` | V1 ↔ V2 (`errorResponses`) | CFN CloudFront change → express skips the stabilization wait |

After a `.ts` toggle, run `npm run build`. (The Lambda toggle is plain JS — no
build.) To restore all toggles to baseline between runs: `npm run reset`, then
`npm test` to confirm 43/43.

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

> "I added a per-session analytics dashboard to the app. Synth went from instant
> to painful. Watch."

**Run the slow synth** (the analytics construct is behind a context flag):

```bash
time npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null
```

Let them see the wall-clock seconds.

**Now bring in the skill.** In Kiro (or your agent of choice), the
`cdk-synth-performance` skill is in `.kiro/skills/`. Ask:

> "My synth is slow. Investigate where the time is going."

The skill captures a CPU profile and reports back. The finding it should land
on:

- Construction phase dominates.
- One user-code function — `hashConfig` / `buildSessionFingerprint` in
  `lib/constructs/analytics.ts` — accounts for most of the time.
- It's called once **per session**, every call re-reading and re-hashing the
  **same** file. Identical input, thrown away each time.

**The talking point:**

> "It's not that CDK is slow. It's that my code hashes the same config file
> twelve times for no reason. The skill didn't guess — it profiled it and
> pointed at the line."

**The fix, live — no typing.** In `lib/constructs/analytics.ts` find the
`DEMO TOGGLE — PHASE 1` banner. There are two blocks: **SLOW** (active) and
**FAST** (commented). Comment the SLOW block, uncomment the FAST block. The FAST
block hoists the read + hash out of the loop so they run once. Then:

```bash
npm run build      # recompile TS -> JS (toggles live in .ts)
time npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null
```

**Re-run** the timed synth — the ~2s of duplicated work disappears.

> "Same dashboard. The waiting is gone."

> **Note for the presenter:** flipping the toggle is optional theatre — the real
> point is the *skill found it*. If you do flip it, remember `npm run build`
> before the re-synth, and `npm run reset` afterward to restore the baseline.

---

## Phase 2 — "Fail fast, not after a 3-minute deploy" (2 min)

This phase toggles the **validation guard itself**, so the audience sees that
the guard is what catches the mistake — not a hand-fix. The broken bucket stays
broken the whole time; only the guard moves.

**File to open:** `lib/phase2-broken-stack.ts` (show the mistake), then
`bin/app.ts` (the `DEMO TOGGLE — PHASE 2` guard banner).

### Step 1 — the "before": guard OFF, bad bucket sails through

Start with the guard **commented out** in `bin/app.ts` (the OFF side).

> "I need a bucket for some assets, and I've made a classic mistake — I've left
> it open to the public. Watch what a plain synth does with that."

```bash
npm run build
npx cdk synth SkipTheWait-Phase2-Broken     # SUCCEEDS (exit 0)
```

> "Synth succeeded. That public bucket is perfectly valid CloudFormation — so a
> plain deploy would happily ship it, and I'd find out in prod. That's the
> problem."

### Step 2 — the "after": turn the guard ON

In `bin/app.ts`, uncomment the **GUARD ON** block (the
`Validations.of(app).addPlugins(new CfnGuardValidator(...))` call). **Nothing
about the bucket changes.**

```bash
npm run build
npx cdk synth SkipTheWait-Phase2-Broken     # now FAILS (exit 1)
```

It fails at synth with:

```
ERROR [CT.S3.PR.1]: Require an Amazon S3 bucket to have block public access settings configured
   SkipTheWait-Phase2-Broken/PublicAssets/Resource (PublicAssetsACF28B1B) aws-cdk-lib.aws_s3.CfnBucket
   Suggested fix: The parameters 'BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls',
   'RestrictPublicBuckets' must be set to true under the bucket-level 'PublicAccessBlockConfiguration'.
```

**The talking point (this is the proof):**

> "Same bucket, same template. The only thing I changed was turning the
> validation guard on. Now the exact misconfiguration is caught at synth — on my
> laptop, in one second — with the rule and the construct path. That's synth-time
> validation doing the work, not me."

> **Under the hood:** the guard is a real online policy-validation plugin
> (`@cdklabs/cdk-validator-cfnguard`) registered via
> `Validations.of(app).addPlugins(...)` in `bin/app.ts`. For a legible demo we
> scoped it to the single S3 public-access rule
> (`rules/s3-block-public-access.guard`) so it's one clean finding.

> **Say the bigger capability:** this same plugin ships the full **Control Tower
> proactive security controls** — dozens of managed rules (encryption at rest,
> versioning, access logging, SSL-only, public-access, and more) across many
> resource types. Drop `controlTowerRulesEnabled: false` in `bin/app.ts` and it
> validates the whole app against that managed security ruleset at synth. You can
> also add CDK Nag, OPA, or your org's own CFN-Guard rules the same way. Point:
> this isn't one hand-written check — it's a pluggable, shift-left security gate
> that runs before anything leaves your laptop.

> **Reset:** the baseline is guard **ON**. `npm run reset` restores it.

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

**Proof the mechanism matters — this is a CloudFront change.** First, show that
hotswap can't do it:

```bash
# Optional: prove hotswap declines this change
cdk deploy SkipTheWait-FeedbackWall --hotswap
# → "SkipTheWait-FeedbackWall (no changes)":
#   CloudFront distribution changes are NOT hotswappable.
```

Then deploy it through CloudFormation with express, and it reports complete as
soon as the config is applied — instead of blocking on CloudFront's
stabilization/propagation.

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
npm test                                    # expect 45/45, "Ground state is GOOD"

# Phase 1 — slow synth + investigation
time npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null
# (flip SLOW->FAST toggle in analytics.ts, then:)  npm run build && <re-run synth>

# Phase 2 — fail fast (toggle the GUARD in bin/app.ts, not the bucket)
# guard OFF (before): broken bucket slips through
npm run build && npx cdk synth SkipTheWait-Phase2-Broken     # SUCCEEDS
# guard ON (after): same bucket now caught
npm run build && npx cdk synth SkipTheWait-Phase2-Broken     # FAILS: CT.S3.PR.1 + path

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
