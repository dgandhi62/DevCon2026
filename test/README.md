# Ground-state check

A pre-demo sanity check for the "AWS CDK — Skip the wait" booth demo. Run it to
confirm the repo is in its known-good baseline, or to find out what a rehearsal
left broken.

```bash
npm test          # run all checks
npm run reset     # restore demo code to the last commit, then rebuild
```

## What "ground state" means here

This demo ships **deliberately broken/slow code** — that's the point of Phases 1
and 2. So the check does NOT assert "everything passes." It asserts the demo is
in the exact shape the script expects:

| Thing | Expected in ground state |
| --- | --- |
| The real app (`SkipTheWait-FeedbackWall`) | Synths clean, exit 0, no warnings |
| Phase 2 broken stack | **Fails** synth with `CT.S3.PR.1` + construct path |
| Phase 2 fixed stack | Passes synth |
| Phase 1 analytics | Synths, but **measurably slower** than the fast path |
| Phase 1 bottleneck code | Duplicated read + `pbkdf2Sync` still present |
| Phase 3 targets | Lambda routes, directory asset, config.js wiring intact |
| Validation plugin | Registered in `bin/app.ts` via `Validations.of(app)` |

40 checks across 9 sections. Offline only — **no AWS account, no deploy.**

## When it fails

The output tells you exactly which check drifted. Almost always it's an edit you
left in place while rehearsing (e.g. you "fixed" the slow analytics or the public
bucket and forgot to undo it). To get back to baseline:

```bash
npm run reset     # git checkout -- bin lib lambda frontend rules + rebuild
npm test          # confirm 40/40
```

If `npm run reset` can't fix it, you have uncommitted baseline changes — inspect
with `git status` and `git diff`.

## What this does NOT test

Phase 3 deploys (`--hotswap`, `--express`) need a real AWS account and are not
covered here. Rehearse those separately against your own account before the
event — see `docs/HOTSWAP.md` and `docs/EXPRESS-MODE.md`.
