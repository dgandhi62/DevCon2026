import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * PHASE 2 — "Fail fast, not after a 3 minute deploy"
 *
 * This stack ALWAYS contains the misconfiguration: an S3 bucket wide open to
 * the public (block-public-access off, public read granted). It synthesizes
 * into perfectly valid CloudFormation.
 *
 * The Phase 2 demo does NOT toggle this bucket. It toggles the VALIDATION GUARD
 * in bin/app.ts:
 *
 *   • Guard OFF → `cdk synth SkipTheWait-Phase2-Broken` SUCCEEDS. The bad
 *     bucket sails through — just like it would on a plain deploy. ("before")
 *   • Guard ON  → the SAME stack FAILS synth with CT.S3.PR.1 + the construct
 *     path. The guard is provably what caught it. ("after")
 *
 * That makes the demo about the CAPABILITY (synth-time validation), not about
 * hand-fixing a bucket.
 */
export class Phase2BrokenStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The misconfiguration. Public access is turned off at the bucket level and
    // public read is granted. Left in place on purpose — the guard is what
    // decides whether this is allowed to reach a deploy.
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

    new cdk.CfnOutput(this, 'PublicAssetsBucketName', {
      value: bucket.bucketName,
    });
  }
}
