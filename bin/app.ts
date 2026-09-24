#!/usr/bin/env node
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { CfnGuardValidator } from '@cdklabs/cdk-validator-cfnguard';
import { FeedbackWallStack } from '../lib/feedback-wall-stack';

const app = new cdk.App();

// ┌────────────────────────────────────────────────────────────────────────┐
// │ DEMO TOGGLE — PHASE 2, LAYER 2  (policy validation plugin: OFF ↔ ON)     │
// │                                                                          │
// │ Registers the CFN-Guard policy-validation plugin that runs right after   │
// │ synth. This is the SECOND validation layer: CDK's own built-in synth     │
// │ validation (Layer 1) always runs regardless; this plugin adds security-  │
// │ policy checks on top.                                                    │
// │                                                                          │
// │ With the website bucket on toggle B (see website.ts), CDK's built-in     │
// │ validation passes but this plugin FAILS synth on CT.S3.PR.1 with the     │
// │ construct path. Comment this out to show the "before" (bad bucket slips  │
// │ past the plugin — though Layer-1 built-in checks still apply).           │
// │                                                                          │
// │ Scoped to one rule (S3 Block Public Access) for a clean, single finding. │
// └────────────────────────────────────────────────────────────────────────┘

// ---- PLUGIN ON (default) --------------------------------------------------
cdk.Validations.of(app).addPlugins(
  new CfnGuardValidator({
    controlTowerRulesEnabled: false,
    rules: [path.join(__dirname, '..', 'rules', 's3-block-public-access.guard')],
  }),
);
// ---------------------------------------------------------------------------

// ---- PLUGIN OFF (the "before"): comment the block above -------------------
// ---------------------------------------------------------------------------

// Analytics (the Session Insights panel + the Phase 1 slow-synth bottleneck) is
// ON by default — it's part of the base app. Pass `-c includeAnalytics=false`
// to drop it and synth the fast baseline for contrast.
const includeAnalytics = app.node.tryGetContext('includeAnalytics') !== 'false';

new FeedbackWallStack(app, 'SkipTheWait-FeedbackWall', {
  description: 'The CDK Booth Feedback Wall — live reactions app for DevCon 2026.',
  includeAnalytics,
});

app.synth();
