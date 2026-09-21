#!/usr/bin/env node
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { CfnGuardValidator } from '@cdklabs/cdk-validator-cfnguard';
import { FeedbackWallStack } from '../lib/feedback-wall-stack';
import { Phase2BrokenStack } from '../lib/phase2-broken-stack';
import { Phase2FixedStack } from '../lib/phase2-fixed-stack';

/**
 * AWS CDK - "Skip the wait"  ·  DevCon 2026 booth demo.
 *
 * Stacks:
 *   SkipTheWait-FeedbackWall     the real, working app (DynamoDB + Lambda + API GW + CloudFront)
 *   SkipTheWait-Phase2-Broken    a misconfiguration synth-time validation catches
 *   SkipTheWait-Phase2-Fixed     the corrected version that passes
 *
 * Phase 1 (slow synth) is driven by a context flag so the everyday app stays
 * fast. Turn the slow analytics construct on for the Phase 1 walkthrough:
 *
 *   npx cdk synth SkipTheWait-FeedbackWall -c includeAnalytics=true
 *
 * Everything synthesizes offline. Only the FeedbackWall stack is meant to be
 * deployed (Phase 3: --hotswap and --express), against your own account.
 */
const app = new cdk.App();

// Synth-time validation. This is the Phase 2 capability: right after synth,
// the plugin validates every generated template. A violation fails synth and
// prints the failing rule + the construct path — you never reach a deploy.
//
// We scope it to ONE crisp, legible rule for the demo: S3 bucket-level Block
// Public Access (CT.S3.PR.1). The full Control Tower rule set is turned off
// so the story stays about the one mistake we're making, not a wall of
// unrelated findings. Drop `controlTowerRulesEnabled: false` to run them all.
//
// Registered via the Validations class (the non-deprecated API) rather than
// the App's `policyValidationBeta1` prop.
cdk.Validations.of(app).addPlugins(
  new CfnGuardValidator({
    controlTowerRulesEnabled: false,
    rules: [path.join(__dirname, '..', 'rules', 's3-block-public-access.guard')],
  }),
);

const includeAnalytics = app.node.tryGetContext('includeAnalytics') === 'true';

new FeedbackWallStack(app, 'SkipTheWait-FeedbackWall', {
  description: 'The CDK Booth Feedback Wall — live reactions app for DevCon 2026.',
  includeAnalytics,
});

new Phase2BrokenStack(app, 'SkipTheWait-Phase2-Broken', {
  description: 'Phase 2: an obvious misconfiguration that synth-time validation catches before deploy.',
});

new Phase2FixedStack(app, 'SkipTheWait-Phase2-Fixed', {
  description: 'Phase 2: the corrected stack that passes synth-time validation.',
});

app.synth();
