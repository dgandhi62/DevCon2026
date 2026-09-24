#!/usr/bin/env node
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { CfnGuardValidator } from '@cdklabs/cdk-validator-cfnguard';
import { FeedbackWallStack } from '../lib/feedback-wall-stack';

const app = new cdk.App();

// ---- PLUGIN OFF (default / baseline) --------------------------------------
// (nothing registered — only CDK built-in validation runs)
// ---------------------------------------------------------------------------

// ---- PLUGIN ON (the "after"): uncomment to register the guard -------------
// cdk.Validations.of(app).addPlugins(
//   new CfnGuardValidator({
//     controlTowerRulesEnabled: false,
//     rules: [path.join(__dirname, '..', 'rules', 's3-block-public-access.guard')],
//   }),
// );
// ---------------------------------------------------------------------------

// Pass `-c includeAnalytics=false to drop analytics if not needed.
const includeAnalytics = app.node.tryGetContext('includeAnalytics') !== 'false';

new FeedbackWallStack(app, 'SkipTheWait-FeedbackWall', {
  description: 'The CDK Booth Feedback Wall — live reactions app for DevCon 2026.',
  includeAnalytics,
});

app.synth();
