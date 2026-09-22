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

| Phase | File with the toggle | Flip |
| --- | --- | --- |
| 1 | `lib/constructs/analytics.ts` | SLOW ↔ FAST |
| 2 | `lib/phase2-broken-stack.ts` | BROKEN ↔ FIXED |
| 3a | `lambda/reactions/index.js` | V1 ↔ V2 (adds `source` stamp) |
| 3b | `lib/constructs/website.ts` | V1 ↔ V2 (adds `errorResponses`) |

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

**File to open:** `lib/phase2-broken-stack.ts`

**Setup line:**

> "Next change. I need a bucket for some assets. But I make a classic mistake —
> I leave it open to the public."

Point at the active **BROKEN** block under the `DEMO TOGGLE — PHASE 2` banner —
`blockPublicAccess` with all four flags `false`, plus `publicReadAccess: true`.

**Run synth:**

```bash
npx cdk synth SkipTheWait-Phase2-Broken
```

It **fails at synth** with:

```
ERROR [CT.S3.PR.1]: Require an Amazon S3 bucket to have block public access settings configured
   SkipTheWait-Phase2-Broken/PublicAssets/Resource (PublicAssetsACF28B1B) aws-cdk-lib.aws_s3.CfnBucket
   Suggested fix: The parameters 'BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls',
   'RestrictPublicBuckets' must be set to true under the bucket-level 'PublicAccessBlockConfiguration'.
```

**The talking point:**

> "That template is perfectly valid CloudFormation. A plain deploy would have
> accepted it and I'd have shipped a public bucket — or found out three minutes
> into a deploy. Instead it failed on my laptop, in one second, and told me the
> exact construct path and the fix."

**The fix, live — no typing.** In `lib/phase2-broken-stack.ts` find the
`DEMO TOGGLE — PHASE 2` banner. Comment the **BROKEN** block, uncomment the
**FIXED** block (`BLOCK_ALL`). Then:

```bash
npm run build
npx cdk synth SkipTheWait-Phase2-Broken     # now PASSES, exit 0
```

> "Fixed in seconds, because I learned about it in seconds."

> (Prefer switching stacks over toggling? `npx cdk synth SkipTheWait-Phase2-Fixed`
> is a standalone always-passing version. Either works.)

> **Under the hood:** validation runs via a policy plugin registered on the App
> in `bin/app.ts`. We've scoped it to the single public-access rule
> (`rules/s3-block-public-access.guard`) so the demo stays about one clear
> mistake. In production you'd run the full managed rule set.

---

## Phase 3 — "Quick deployments" (2–3 min, needs an AWS account)

> Only run the actual deploys if you're at a booth with credentials. Otherwise
> narrate it against the synthesized output.

### 3a. Hotswap — a Lambda code change

**File to open:** `lambda/reactions/index.js`

**Setup line:**

> "The app's live. I want to tweak the API — tag every new reaction. That's a
> Lambda code change. Normally: full CloudFormation deploy. Watch this."

**No typing.** In `lambda/reactions/index.js` find the `DEMO TOGGLE — PHASE 3a`
banner. Comment **V1**, uncomment **V2** (V2 adds `source: "hotswap-demo"` to
each new reaction). The handler is plain JS — no build step needed.

**Deploy with hotswap:**

```bash
cdk deploy SkipTheWait-FeedbackWall --hotswap --require-approval never
```

> "CDK saw the only change was Lambda code, so it skipped CloudFormation
> entirely and called the Lambda UpdateFunctionCode API directly. Seconds, not
> minutes."

Post a new reaction and show the `source: "hotswap-demo"` field is now present
(via the API response or the wall) — proof the new code is live.

> **Say the caveat:** hotswap deliberately introduces drift. It's a development
> accelerator, not for production.

### 3b. Express mode — a broader infrastructure change

**File to open:** `lib/constructs/website.ts`

**Setup line:**

> "Now a change hotswap can't do — real infrastructure. This goes through
> CloudFormation. But I don't need to wait for every resource to fully stabilize
> while I'm iterating."

**No typing.** Find the `DEMO TOGGLE — PHASE 3b` banner. Comment **V1**,
uncomment **V2** (V2 adds SPA-style `errorResponses` to the CloudFront
distribution — a genuine template change, not hotswappable). Then:

```bash
npm run build
cdk deploy SkipTheWait-FeedbackWall --express --require-approval never
```

> "Express mode reports each resource done as soon as CloudFormation applies the
> config, instead of waiting for full stabilization. Up to ~4x faster for the
> iterative changes you make all day while building."

> **Say the caveat:** express mode doesn't wait for stabilization and won't
> auto-rollback unless you add `--rollback`. Great for dev iteration, not for
> production.

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

# Phase 1 — slow synth + investigation
time npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null
# (flip SLOW->FAST toggle in analytics.ts, then:)  npm run build && <re-run synth>

# Phase 2 — fail fast
npx cdk synth SkipTheWait-Phase2-Broken     # FAILS: CT.S3.PR.1 + construct path
# (flip BROKEN->FIXED toggle, then:)  npm run build && npx cdk synth SkipTheWait-Phase2-Broken  # PASSES

# Phase 3 — fast deploys (needs an account)
# (flip V1->V2 in lambda/reactions/index.js, then:)
cdk deploy SkipTheWait-FeedbackWall --hotswap --require-approval never
# (flip V1->V2 in website.ts, then:)  npm run build &&
cdk deploy SkipTheWait-FeedbackWall --express --require-approval never
cdk deploy SkipTheWait-FeedbackWall --express --rollback   # express + auto-rollback

# After a run: restore every toggle to baseline
npm run reset && npm test
```
