import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

/**
 * The static feedback-wall frontend: an S3 bucket (private) served through
 * CloudFront, populated by a BucketDeployment.
 *
 * >>> This is the Phase 3 EXPRESS-MODE target. <<<
 * Broader infrastructure changes here (the CloudFront distribution, the bucket,
 * the deployment) go through CloudFormation. `cdk deploy --express` reports the
 * stack complete as soon as CloudFormation applies each resource's config,
 * skipping the stabilization waits — up to ~4x faster for iterative work.
 *
 * The API URL is injected at deploy time as `config.js` (window.FEEDBACK_API),
 * so the frontend has no hard-coded endpoint.
 */
export interface FeedbackWebsiteProps {
  /** The API invoke URL the frontend should call. */
  readonly apiUrl: string;
}

export class FeedbackWebsite extends Construct {
  /** The (private) bucket holding the static site. */
  public readonly bucket: s3.Bucket;

  /** The CloudFront distribution serving the site. */
  public readonly distribution: cloudfront.Distribution;

  /** The public URL of the feedback wall. */
  public readonly url: string;

  constructor(scope: Construct, id: string, props: FeedbackWebsiteProps) {
    super(scope, id);

    // Private bucket — locked down. CloudFront reaches it via Origin Access.
    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      comment: 'CDK Booth Feedback Wall (DevCon 2026)',
    });

    // Deploy the static assets, plus a generated config.js carrying the API URL.
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', 'frontend')),
        s3deploy.Source.data(
          'config.js',
          `window.FEEDBACK_API = ${JSON.stringify(props.apiUrl)};`,
        ),
      ],
    });

    this.url = `https://${this.distribution.distributionDomainName}`;
  }
}
