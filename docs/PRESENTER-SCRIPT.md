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

**The fix, live.** In `analytics.ts`, the work is duplicated inside the loop.
Hoist it out so it runs once:

```ts
// BEFORE (inside the loop): recomputed every iteration
for (let i = 0; i < sessionCount; i++) {
  const fingerprint = buildSessionFingerprint(i, hashRounds); // re-hashes whole file
  const session = readConfig().sessions[i];                   // re-reads file
  ...
}

// AFTER: compute the expensive, invariant parts ONCE, before the loop
const config = readConfig();               // read + parse once
const baseHash = hashConfig(hashRounds);   // hash the file once, not per-session
for (let i = 0; i < config.sessions.length; i++) {
  // cheap: only the per-session suffix varies
  const fingerprint = crypto.createHash('sha256').update(baseHash + ':' + i).digest('hex');
  const session = config.sessions[i];
  ...
}
```

**Re-run** the timed synth — seconds become sub-second.

> "Same dashboard. The waiting is gone."

> **Note for the presenter:** you don't have to apply the fix by hand on stage —
> `analytics.ts` is written so the bottleneck is obvious. Applying the hoist is
> optional theatre. The point is the *skill found it*.

---

## Phase 2 — "Fail fast, not after a 3-minute deploy" (2 min)

**File to open:** `lib/phase2-broken-stack.ts`

**Setup line:**

> "Next change. I need a bucket for some assets, so I write one. But I make a
> classic mistake — I leave it open to the public."

Point at the `blockPublicAccess` block, all four flags `false`.

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

**The fix, live.** Open `lib/phase2-fixed-stack.ts` (or edit the broken one):

```ts
blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
```

**Run synth on the fixed stack:**

```bash
npx cdk synth SkipTheWait-Phase2-Fixed     # passes, exit 0
```

> "Fixed in seconds, because I learned about it in seconds."

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

> "The app's live. I want to tweak the API — say, tag every new reaction. That's
> a Lambda code change. Normally: full CloudFormation deploy. Watch this."

Make a small, visible change in the handler (e.g. in `createReaction`, prefix
the stored message or bump a version string returned by the API).

**Deploy with hotswap:**

```bash
cdk deploy SkipTheWait-FeedbackWall --hotswap
```

> "CDK saw the only change was Lambda code, so it skipped CloudFormation
> entirely and called the Lambda UpdateFunctionCode API directly. Seconds, not
> minutes."

Refresh the wall to show the change is live.

> **Say the caveat:** hotswap deliberately introduces drift. It's a development
> accelerator, not for production.

### 3b. Express mode — a broader infrastructure change

**File to open:** `lib/constructs/website.ts` (or anything structural)

**Setup line:**

> "Now a change hotswap can't do on its own — real infrastructure. This goes
> through CloudFormation. But I don't need to wait for every resource to fully
> stabilize while I'm iterating."

**Deploy with express mode:**

```bash
cdk deploy SkipTheWait-FeedbackWall --express
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
# Phase 1 — slow synth + investigation
time npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile" npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true > /dev/null

# Phase 2 — fail fast
npx cdk synth SkipTheWait-Phase2-Broken     # FAILS: CT.S3.PR.1 + construct path
npx cdk synth SkipTheWait-Phase2-Fixed      # PASSES

# Phase 3 — fast deploys (needs an account)
cdk deploy SkipTheWait-FeedbackWall --hotswap
cdk deploy SkipTheWait-FeedbackWall --express
cdk deploy SkipTheWait-FeedbackWall --express --rollback   # express + auto-rollback
```
