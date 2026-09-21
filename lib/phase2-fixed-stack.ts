import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * PHASE 2 (fixed) — the correction.
 *
 * Same intent as Phase2-Broken (a bucket for assets), but locked down: block
 * ALL public access, enforce SSL, encrypt at rest. The built-in validation
 * plugin now has nothing to flag, so `cdk synth SkipTheWait-Phase2-Fixed`
 * passes and you move straight on to deploying.
 *
 * The story: the fix took seconds because you learned about the problem at
 * synth time on your laptop — not three minutes into a CloudFormation deploy.
 */
export class Phase2FixedStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'PublicAssets', {
      // The fix: block all public access (the CDK default, made explicit here).
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cdk.CfnOutput(this, 'PublicAssetsBucketName', {
      value: bucket.bucketName,
    });
  }
}
