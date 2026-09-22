import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * PHASE 2 — "Fail fast, not after a 3 minute deploy"
 *
 * One stack, one demo toggle. Synth-time validation runs right after synth. The
 * BROKEN bucket is wide open to the public and FAILS validation (prints the
 * rule + construct path, on your laptop, before any deploy). The FIXED bucket
 * blocks all public access and PASSES.
 *
 * At the booth:
 *   npx cdk synth SkipTheWait-Phase2-Broken   # BROKEN block -> FAILS
 *   (flip the toggle below, re-run)           # FIXED block  -> PASSES
 *
 * (SkipTheWait-Phase2-Fixed still exists as a separate always-passing stack if
 * you'd rather switch stacks than toggle. Either approach works.)
 */
export class Phase2BrokenStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ┌──────────────────────────────────────────────────────────────────┐
    // │ DEMO TOGGLE — PHASE 2  (broken ↔ fixed)                            │
    // │                                                                    │
    // │ Comment ONE block, uncomment the OTHER. Nothing else changes.      │
    // │  • BROKEN block = public bucket   -> synth FAILS on CT.S3.PR.1      │
    // │  • FIXED block  = BLOCK_ALL       -> synth PASSES                   │
    // └──────────────────────────────────────────────────────────────────┘

    // ---- BROKEN (default): public bucket, validation FAILS --------------
    const bucket = new s3.Bucket(this, 'PublicAssets', {
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // ---------------------------------------------------------------------

    // ---- FIXED (the fix): block all public access, validation PASSES ----
    // const bucket = new s3.Bucket(this, 'PublicAssets', {
    //   blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    //   encryption: s3.BucketEncryption.S3_MANAGED,
    //   enforceSSL: true,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    //   autoDeleteObjects: true,
    // });
    // ---------------------------------------------------------------------

    new cdk.CfnOutput(this, 'PublicAssetsBucketName', {
      value: bucket.bucketName,
    });
  }
}
