# Express mode — everything you need to know

Ground-up reference for `cdk deploy --express`, tailored to the Booth Feedback
Wall demo. Read this before Phase 3b.

---

## 1. The one-sentence version

Express mode still deploys through CloudFormation (so it's safe and template-
consistent), but CloudFormation reports each resource **done as soon as the
config is applied** instead of waiting for the resource to fully stabilize —
making iterative deploys significantly faster (the submission cites up to ~4x).

---

## 2. The problem it solves

In a **default** CloudFormation deploy, CFN waits for each resource to reach a
fully stabilized, operational state before marking it complete. Examples:

- An EC2 instance → waits until it's `running` (and past status checks).
- A CloudFront distribution → waits until it's deployed to all edges.
- An ECS service → waits until tasks reach steady state.

That stabilization wait is exactly what you *don't* need while iterating. You
just want to know "did my configuration apply and is it valid?" — not "is the
CDN fully propagated to every edge on earth?"

Express mode changes **when the operation reports complete**, not what gets
deployed.

---

## 3. How it actually works

- In default mode: CFN applies the resource config, then **polls until the
  resource is fully stable**, then reports complete.
- In express mode: CFN typically considers a resource operation complete **as
  soon as the create/update/delete API call succeeds**. In most cases it does
  **not** wait for the final operational state.

Consequences right after an express deploy reports "done":

- Resources may still be initializing or propagating.
- Resources may not yet be ready to serve traffic / accept connections.
- Delete operations may still be finishing in the background.

**Dependencies are still respected.** If resource B references resource A (via
`Ref` / `Fn::GetAtt`), CFN confirms A's config is applied before starting B, and
retries B if it hits a transient "A isn't ready yet" error. Independent
resources still deploy in parallel. Express mode does **not** reorder your graph
— it only changes the completion signal.

---

## 4. How to enable it

```bash
# CDK (this demo)
cdk deploy --express

# CDK with automatic rollback re-enabled (see §6)
cdk deploy --express --rollback
```

For reference, the same capability in other tools:

```bash
# Raw CloudFormation CLI
aws cloudformation update-stack --stack-name my-stack \
  --template-body file://template.yaml \
  --deployment-config '{"mode": "EXPRESS"}'

# With rollback on
--deployment-config '{"mode": "EXPRESS", "disableRollback": false}'

# AWS SAM
sam deploy --express
```

Express mode works with **all existing templates** — no template changes
required. It's also available in the CloudFormation console (Configure stack
options → Deployment options → Express) and with change sets.

---

## 5. In THIS demo — what to deploy with express

Express mode is the answer for the changes hotswap *can't* do: real
infrastructure. In this app that's the website/CDN/bucket in
**`lib/constructs/website.ts`** or anything structural (new resource, new
output, changed CloudFront/API config).

**A good broader change to make on stage** — e.g. add a resource or change the
CloudFront/website construct, then:

```bash
cdk deploy SkipTheWait-FeedbackWall --express
```

The story to tell: "This goes through CloudFormation — it's a real, consistent
deploy — but I'm not sitting through the CloudFront stabilization wait while I
iterate."

> Note: the first-ever create of the CloudFront distribution still has to
> propagate globally regardless; express mode just stops CFN from *blocking* on
> that. For the most dramatic contrast, demo express on an **update** to an
> existing deployed stack, not the very first create.

---

## 6. Rollback — the important gotcha

**Express mode disables rollback by default.** If a resource operation fails
mid-deploy, CloudFormation does **not** automatically roll back — the stack is
left in a failed/partial state for you to inspect or fix forward.

- Fine for dev iteration (you often *want* to see what failed and fix forward).
- To restore automatic rollback, add `--rollback`:

```bash
cdk deploy SkipTheWait-FeedbackWall --express --rollback
```

Say this out loud in the demo — "express doesn't auto-rollback unless I ask."

---

## 7. Nested stacks & custom resources

- **Nested stacks:** enabling express on a parent stack **propagates to all
  nested stacks** automatically. You don't set it per nested stack.
- **Custom resources:** these keep their normal behavior even in express mode —
  CFN still waits for the custom resource to send its response signal.

  This matters for this app: the `BucketDeployment` and S3 `autoDeleteObjects`
  features are Lambda-backed **custom resources**. Express mode won't skip
  waiting on those. If a custom resource is slow, cap it with the
  `ServiceTimeout` property so it can't stall your fast iteration loop.

---

## 8. Limitations

- **Not supported with CloudFormation StackSets.**
- Custom resources don't get the "skip stabilization" benefit (see §7).
- Not recommended for **production** — because it reports success before
  resources are verified stable, and rollback is off by default. It's built for
  development/iteration.

---

## 9. Express mode vs hotswap — when to reach for which

| | Express mode | Hotswap |
| --- | --- | --- |
| Mechanism | Through CloudFormation | Bypasses CloudFormation, calls service APIs |
| Template compatibility | All templates | Limited set of resource types |
| Stack state | Stays consistent with template | May drift from template |
| Rollback | Supported (off by default) | None |
| Resource coverage | All CFN resource types | Lambda, ECS, Step Functions, and others |
| Best for | Broader infra changes while iterating | Code-only changes to supported resources |

**Rule of thumb for the booth:**
- Changed **code** on a supported resource (Lambda, the BucketDeployment) →
  `--hotswap`.
- Changed **infrastructure shape** (new/changed resources, IAM, CloudFront) →
  `--express`.
- Want a safety net → `--express --rollback` or `--hotswap-fallback`.

---

## 10. Quick reference

```bash
cdk deploy SkipTheWait-FeedbackWall --express              # fast iterative deploy
cdk deploy SkipTheWait-FeedbackWall --express --rollback   # + auto-rollback on failure
```

**Mental model:** express = "deploy it properly through CloudFormation, but
don't make me wait for everything to fully stabilize while I'm iterating."
