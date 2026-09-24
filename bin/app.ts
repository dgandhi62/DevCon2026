#!/usr/bin/env node
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { CfnGuardValidator } from '@cdklabs/cdk-validator-cfnguard';
import { FeedbackWallStack } from '../lib/feedback-wall-stack';
import { Phase2BrokenStack } from '../lib/phase2-broken-stack';

/**
 * AWS CDK - "Skip the wait"  ·  DevCon 2026 booth demo.
 *
 * Stacks:
 *   SkipTheWait-FeedbackWall     the real, working app (DynamoDB + Lambda + API GW + CloudFront)
 *   SkipTheWait-Phase2-Broken    a misconfiguration synth-time validation catches
 *
 * Phase 1 (slow synth) is baked into the base app — analytics is ON by default,
 * so `cdk synth SkipTheWait-FeedbackWall` is slow out of the box. Drop it to see
 * the fast baseline:
 *
 *   npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=false
 *
 * Everything synthesizes offline. Only the FeedbackWall stack is meant to be
 * deployed (Phase 3: --hotswap and --express), against your own account.
 */
const app = new cdk.App();

// ┌────────────────────────────────────────────────────────────────────────┐
// │ DEMO TOGGLE — PHASE 2  (synth-time validation: OFF ↔ ON)                 │
// │                                                                          │
// │ This registers the policy-validation plugin that runs right after synth. │
// │ It is the WHOLE POINT of Phase 2 — so we toggle the GUARD itself, not    │
// │ the bucket. The Phase2-Broken stack always has the public bucket.        │
// │                                                                          │
// │  • OFF (guard commented): `cdk synth SkipTheWait-Phase2-Broken` SUCCEEDS │
// │      — the misconfigured template sails through, exactly like it would   │
// │      on a plain deploy. This is the "before".                            │
// │  • ON  (guard uncommented): the SAME stack now FAILS synth with          │
// │      CT.S3.PR.1 + the construct path. The guard is provably what caught  │
// │      it. This is the "after".                                            │
// │                                                                          │
// │ Scoped to one rule (S3 Block Public Access) so the story is one clean    │
// │ finding. Registered via the Validations class (non-deprecated API).      │
// └────────────────────────────────────────────────────────────────────────┘

// ---- GUARD ON (default): validation runs, broken bucket is caught ---------
cdk.Validations.of(app).addPlugins(
  new CfnGuardValidator({
    controlTowerRulesEnabled: false,
    rules: [path.join(__dirname, '..', 'rules', 's3-block-public-access.guard')],
  }),
);
// ---------------------------------------------------------------------------

// ---- GUARD OFF (the "before"): no validation, broken bucket slips through --
// (comment the block above, and this whole demo has no guard registered)
// ---------------------------------------------------------------------------

// Analytics (the Session Insights panel + the Phase 1 slow-synth bottleneck) is
// ON by default — it's part of the base app. Pass `-c includeAnalytics=false`
// to drop it and synth the fast baseline for contrast.
const includeAnalytics = app.node.tryGetContext('includeAnalytics') !== 'false';

new FeedbackWallStack(app, 'SkipTheWait-FeedbackWall', {
  description: 'The CDK Booth Feedback Wall — live reactions app for DevCon 2026.',
  includeAnalytics,
});

new Phase2BrokenStack(app, 'SkipTheWait-Phase2-Broken', {
  description: 'Phase 2: an obvious misconfiguration that synth-time validation catches before deploy.',
});

app.synth();
