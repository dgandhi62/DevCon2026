import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * PHASE 2 (broken) — "Fail fast, not after a 3 minute deploy"
 *
 * A stack with an obvious, deploy-breaking misconfiguration. The point is that
 * you never get to deploy: the built-in CloudFormation validation plugin
 * (@aws/cloudformation-validate) runs immediately AFTER synth, catches it,
 * prints the failing rule plus the CONSTRUCT PATH, and fails the synth.
 *
 * The mistake: an S3 bucket wide open to the public. We turn OFF block-public-
 * access and grant public read. It synthesizes into perfectly valid
 * CloudFormation — which is exactly why a plain deploy used to let it through
 * and you only found out minutes into the deploy (or worse, in production).
 *
 * At the booth:
 *   npx cdk synth SkipTheWait-Phase2-Broken
 * and let the validation report do the talking, then switch to Phase2-Fixed.
 */
export class Phase2BrokenStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // MISCONFIGURATION: a public bucket. Turning block-public-access off is the
    // root cause the validator flags, with this construct's path in the report.
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
