# AWS IAC: Skip the pain · Cheat Sheet

Which acceleration to reach for at each stage of the loop.

```
   AUTHOR  ─────────►  SYNTH  ─────────►  DEPLOY  ─────────►  ITERATE
     │                   │                  │                   │
     ▼                   ▼                  ▼                   ▼
 synth-perf         synth-time          hotswap /           back to
   skill            validation          express             author
```

---

## authoring → "why is my synth slow?"

**Use the `cdk-synth-performance` skill.**

An agentic skill that captures a CPU profile of your `cdk synth` and tells you
which phase, which construct, and which lines are eating the time — instead of
you guessing.

```
Ask your agent: "my synth is slow, investigate where the time goes"
```

Best for: slow synth, big apps, "it got slow and I don't know why", loops that
instantiate constructs, duplicated work, heavy bundling.

---

## synth → "will this even deploy?"

**Synth-time validation** — two layers: CDK's **built-in** validation (always
runs; catches structural/config mistakes) + a **policy plugin**
(`@cdklabs/cdk-validator-cfnguard`) for security rules.

Both run right after synth. A violation **fails synth on your laptop** and
prints the rule + construct path + a suggested fix. You never waste a deploy on
a misconfig.

```bash
cdk synth        # validation runs; failing rules stop you here
```

Best for: catching public buckets, missing required fields, policy violations,
company standards — before any AWS call.

---

## deploy → "just ship my change, fast"

Pick by **what** you changed:

### Lambda code (and other supported resources) → `--hotswap`

Bypasses CloudFormation entirely; calls the service API directly
(e.g. Lambda `UpdateFunctionCode`). Seconds, not a full deploy.

```bash
cdk deploy --hotswap
```

Supported changes include: Lambda code/config, Step Functions definitions, ECS
container images, S3 bucket-deployment assets, API Gateway, DynamoDB config,
StepFunctions, AppSync, and more. Unsupported changes are skipped with a notice
(use `--hotswap-fallback` to fall back to a full deploy).

⚠️ Introduces drift. Development only.

### Broader infrastructure → `--express`

Full CloudFormation deploy, but reports each resource complete as soon as the
config is applied — **skips stabilization waits**. Up to ~4x faster for
iterative work.

```bash
cdk deploy --express
cdk deploy --express --rollback   # add auto-rollback on failure
```

⚠️ Doesn't wait for stabilization; no auto-rollback unless you add
`--rollback`. Development / iteration, not production.

---

## iterate → repeat, with the waiting removed

| Change you made | Reach for |
| --- | --- |
| Synth feels slow | `cdk-synth-performance` skill |
| Any change, before deploy | synth-time validation (automatic) |
| Lambda code / supported resource | `cdk deploy --hotswap` |
| New / broader infrastructure | `cdk deploy --express` |
| Mixed change, want a safety net | `cdk deploy --hotswap-fallback` or `--express --rollback` |

---

### The one-liner

> The skill tells you where synth time goes. Validation fails you fast, locally.
> Hotswap skips CloudFormation for code. Express skips the stabilization wait for
> everything else. Same loop you run every day — minus the dead time.
