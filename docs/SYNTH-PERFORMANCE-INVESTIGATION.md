# Synth Performance Investigation — SkipTheWait-FeedbackWall

## Summary

`cdk synth SkipTheWait-FeedbackWall` takes **~17 seconds** out of the box. The
cost is not in CDK's synthesis engine — it is user code in the
`SessionAnalytics` construct that re-renders the same template bundle once per
session, turning 600 file reads into 45,000. Rendering the bundle once and
reusing it drops synth back to the **~3.3s** baseline.

## How this was investigated

Following the repo's `cdk-synth-performance` skill:

1. Timed synth with and without the analytics construct to isolate the cost.
2. Captured a CPU profile of `cdk synth` to confirm where time goes, rather than
   trusting the code comments.
3. Traced the dominant profile functions back to the source line driving them.

## Raw data

### Timings

| Run | Command | Time |
| --- | --- | --- |
| Default (analytics on) | `cdk synth SkipTheWait-FeedbackWall` | ~17.0s |
| Analytics off | `cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=false` | ~3.3s |

Analytics accounts for **~13.6s (~80%)** of synth time.

### CPU profile phase breakdown

Captured with:

```bash
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=./profile --max-old-space-size=8192" \
  npx cdk synth SkipTheWait-FeedbackWall > /dev/null
```

The CDK CLI spawns several processes; the app-synth process (16.2s on-CPU) shows:

| Time | % | Function | Where |
| --- | --- | --- | --- |
| 6.08s | 37.5% | `readFileUtf8` | Node fs, driven by `renderReportBundle` |
| 4.14s | 25.6% | `renderReportBundle` | `lib/constructs/analytics.ts` |
| 0.76s | 4.7% | `RegExp: {{(\w+)}}` | the `.replace()` inside `renderReportBundle` |
| 1.04s | 6.4% | `update` | crypto hash of the rendered bundle |

Over **70%** of on-CPU time is `renderReportBundle` and the file reads it drives.
There is no meaningful time in aws-cdk-lib synthesis sub-phases (`prepareApp`,
`resolveReferences`, `synthesizeTree`). This is the skill's
"construction-dominant + time in the user's `lib/` files, not aws-cdk-lib"
signal — a pure user-code bottleneck.

## Root cause

In `lib/constructs/analytics.ts`, the `SessionAnalytics` constructor computes a
per-session `templatesHash`. The current (SLOW) toggle renders the whole
template bundle inside the session loop:

```ts
// SLOW: render the whole template bundle on EVERY session
const reportHashFor = () => hashReportBundle(renderReportBundle());

for (const session of sessions) {
  const templatesHash = reportHashFor().slice(0, 8); // re-renders every iteration
  ...
}
```

`renderReportBundle()` does `fs.readdirSync` + `fs.readFileSync` over the entire
`assets/insight-templates/` directory (**600 `.hbs` files**) plus a regex
replace on each file. The session catalog (`lib/constructs/analytics.config.json`)
has **75 sessions**, so the identical bundle is read and reassembled 75 times:

- 75 sessions × 600 files = **45,000 file reads**, when 600 would suffice.
- The input is identical on every iteration — pure duplicated work.

Loading templates from disk at synth is normal. The mistake is doing it *per
item* instead of *once* and reusing the result.

## The fix

Render the bundle once, before the loop, and reuse the hash. The code ships this
as the FAST toggle in `lib/constructs/analytics.ts`:

```ts
// FAST (the fix): render ONCE, then reuse the hash
const reportHash = hashReportBundle(renderReportBundle());
const reportHashFor = () => reportHash;
```

This produces the identical `insights` payload (same panel, same hashes) with
600 reads instead of 45,000, dropping synth from ~17s toward the ~3.3s baseline.

## Takeaways

- Profile before concluding — the CPU profile confirmed the bottleneck was
  user-code construction, not CDK internals.
- Watch for expensive work (file reads, hashing, parsing) inside loops when the
  input does not change per iteration. Hoist it out and reuse the result.
- Isolating a suspect construct with a context flag (`-c includeAnalytics=false`)
  is a fast way to attribute cost before profiling.
