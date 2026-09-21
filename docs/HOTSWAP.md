# Hotswap — everything you need to know

Ground-up reference for `cdk deploy --hotswap`, tailored to the Booth Feedback
Wall demo. Read this before Phase 3a.

---

## 1. The one-sentence version

Hotswap looks at what changed and, if every change is a supported "code-like"
update, **skips CloudFormation entirely** and pushes the change straight to the
service API (e.g. Lambda `UpdateFunctionCode`). That turns a multi-minute deploy
into a few seconds.

---

## 2. The problem it solves

A normal `cdk deploy` — even for a one-line Lambda code edit — does all of this:

1. Synthesize the template.
2. Upload the new asset to S3.
3. Create a CloudFormation change set.
4. Execute the change set: CloudFormation updates the Lambda, waits for the
   resource to reach a stable state, reports events back.
5. Poll until the stack settles.

For a code-only change, steps 3–5 are pure overhead. You already know exactly
what needs to happen: "put this new zip on that function." Hotswap does just that
one API call.

**Rough feel at the booth:** a normal Lambda-code `cdk deploy` is ~1–3 minutes;
the same change with `--hotswap` is typically a few seconds.

---

## 3. How it actually works

When you run `cdk deploy --hotswap`, the CLI:

1. Synthesizes your app as usual (so **synth-time validation still runs** — you
   don't lose Phase 2).
2. Compares the newly synthesized template against the **currently deployed**
   template.
3. Classifies the diff:
   - **Every change is hotswappable** → the CLI calls the relevant service APIs
     directly and never touches CloudFormation.
   - **Some change is NOT hotswappable** (with plain `--hotswap`) → those changes
     are *ignored*, and the CLI prints a message saying it fell back / skipped.
     (See §6 for the safer `--hotswap-fallback`.)
4. Uses **your current CLI credentials** to make the API calls — it does **not**
   assume the CloudFormation execution role from your bootstrap stack.

> Because it calls service APIs directly, hotswap bypasses IAM policy changes,
> CloudFormation drift tracking, and everything else CFN would normally do.

---

## 4. What you get to hotswap (supported changes)

Hotswapping is supported for a specific, growing set of changes. As of now:

- **AWS Lambda** — code assets (zip + Docker image + inline), tag changes, and a
  subset of configuration (description, environment variables). Also Lambda
  **version and alias** changes.
- **AWS Step Functions** — state machine definition changes.
- **Amazon ECS** — container image (task definition) changes.
- **Amazon S3 bucket deployments** — website/asset changes (i.e.
  `BucketDeployment` content).
- **AWS CodeBuild** — source and environment changes.
- **AWS AppSync** — VTL resolver/function mapping templates, and GraphQL schema.
- **Amazon API Gateway** — REST API, deployment, and method changes.
- **API Gateway V2** — API and integration changes.
- **Amazon Bedrock** — agent configuration; AgentCore Runtime configuration.
- **Amazon EventBridge** — rule changes.
- **Amazon DynamoDB** — table and global-table configuration changes.
- **Amazon SQS** — queue configuration changes.
- **Amazon CloudWatch** — alarm, composite alarm, and dashboard changes.

Supported CloudFormation intrinsics inside hotswapped changes: `Ref`,
`Fn::GetAtt` (partial — via a mix of Cloud Control API and custom logic),
`Fn::ImportValue`, `Fn::Join`, `Fn::Select`, `Fn::Split`, `Fn::Sub`. Hotswap is
also compatible with nested stacks.

**Anything not on this list forces a normal deployment** (or is skipped with
plain `--hotswap`). Creating a brand-new resource, changing IAM, adding a
CloudFront distribution, etc. — not hotswappable.

---

## 5. In THIS demo — what to hotswap

The hotswap target is the reactions Lambda: **`lambda/reactions/index.js`**,
wired up in `lib/constructs/api.ts`. It's a plain-JS directory asset, so there's
no build step between your edit and the deploy.

**A clean, visible change to make on stage** — tag every new reaction so you can
prove the new code is live. In `createReaction()`:

```js
const reaction = {
  id: randomUUID(),
  name,
  message,
  mood,
  votes: 0,
  createdAt: new Date().toISOString(),
  source: "hotswap-demo",   // <-- add a field, or tweak the message formatting
};
```

Then:

```bash
cdk deploy SkipTheWait-FeedbackWall --hotswap
```

You'll see the CLI report a hotswap of the Lambda (no CloudFormation events),
finishing in seconds. Post a new reaction on the wall to show the change landed.

> Both the API's Lambda AND the frontend's `BucketDeployment` are hotswappable
> (Lambda code + S3 website assets). So editing a `frontend/*` file and
> hotswapping also works — the site content is pushed straight to the bucket.

---

## 6. `--hotswap` vs `--hotswap-fallback`

| Flag | If a change ISN'T hotswappable |
| --- | --- |
| `--hotswap` | Ignores that change and warns. Fast, but you can silently under-deploy. |
| `--hotswap-fallback` | Falls back to a full CloudFormation deploy for the whole stack. Safer. |

For a controlled demo, `--hotswap` is fine (you know your change is code-only).
For real dev work, `--hotswap-fallback` is usually the better habit.

```bash
cdk deploy SkipTheWait-FeedbackWall --hotswap-fallback
```

---

## 7. The caveats you MUST say out loud

1. **It introduces drift — on purpose.** After a hotswap, the real resource no
   longer matches what CloudFormation thinks is deployed. That's the trade for
   speed.
2. **Development only. Never production.** This is stated directly in the CDK
   docs. Drift + no rollback + partial coverage make it unsafe for prod.
3. **Credentials matter.** Hotswap uses *your current CLI credentials*, not the
   bootstrap roles. They must be for the **same account** as the stack and have
   permission to update the resource directly (e.g. `lambda:UpdateFunctionCode`).
4. **Some defaults differ under hotswap.** For example, an ECS service's minimum
   healthy percent may be set to 0 during a hotswap. Not relevant to this demo
   (no ECS), but worth knowing.
5. **Reconciling drift later.** When you next do a normal CloudFormation deploy,
   use `cdk deploy --revert-drift` to deploy with a drift-aware change set and
   clean up the drift hotswapping introduced.

---

## 8. Quick reference

```bash
# The demo move: fast Lambda code deploy
cdk deploy SkipTheWait-FeedbackWall --hotswap

# Safer variant: full deploy if something isn't hotswappable
cdk deploy SkipTheWait-FeedbackWall --hotswap-fallback

# Later, on a normal deploy, reconcile drift hotswap introduced
cdk deploy SkipTheWait-FeedbackWall --revert-drift
```

**Mental model:** hotswap = "I changed code, just push the code." If you changed
*shape* (new resources, IAM, networking), that's not hotswap — that's where
express mode (next doc) comes in.
