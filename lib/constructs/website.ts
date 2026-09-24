import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { SessionInsight } from './analytics';

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
 * At deploy time a generated `config.js` is injected next to the static files
 * carrying the API URL (window.FEEDBACK_API) and the Session Insights payload
 * (window.SESSION_INSIGHTS) precomputed by the analytics construct at synth.
 */
export interface FeedbackWebsiteProps {
  /** The API invoke URL the frontend should call. */
  readonly apiUrl: string;

  /**
   * Per-session insights, precomputed at synth time by SessionAnalytics. The
   * wall renders these in its Session Insights panel. Empty if analytics is off.
   */
  readonly sessionInsights: SessionInsight[];
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

    // ┌──────────────────────────────────────────────────────────────────┐
    // │ DEMO TOGGLE — PHASE 2  (fail fast: two layers of synth validation) │
    // │                                                                    │
    // │ "I want to serve files straight from the site bucket, so I make it │
    // │  public." Three states of the SAME website bucket, in order:       │
    // │                                                                    │
    // │  A) BUILT-IN  — publicReadAccess:true, blockPublicAccess left at    │
    // │     BLOCK_ALL. CDK's OWN synth validation throws immediately:       │
    // │     "Cannot use 'publicReadAccess' ... without allowing bucket-     │
    // │     level public access through 'blockPublicAccess'." No plugin,    │
    // │     no deploy — CDK itself catches the inconsistency.               │
    // │                                                                    │
    // │  B) PLUGIN    — you "fix" it by ALSO opening blockPublicAccess.     │
    // │     CDK is now happy... but the bucket is genuinely public. The     │
    // │     CFN-Guard policy plugin fails synth on CT.S3.PR.1 with the      │
    // │     construct path. Caught on your laptop, before deploy.           │
    // │                                                                    │
    // │  C) LOCKED (default) — BLOCK_ALL, no public read. Both pass.        │
    // │                                                                    │
    // │ Uncomment ONE block. Baseline = C.                                  │
    // └──────────────────────────────────────────────────────────────────┘

    // ---- A) BUILT-IN validation catches it (CDK throws at synth) --------
    // this.bucket = new s3.Bucket(this, 'SiteBucket', {
    //   publicReadAccess: true, // blockPublicAccess stays BLOCK_ALL -> CDK rejects
    //   encryption: s3.BucketEncryption.S3_MANAGED,
    //   enforceSSL: true,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    //   autoDeleteObjects: true,
    // });

    // ---- B) POLICY PLUGIN catches it (CDK passes, CFN-Guard fails) ------
    // this.bucket = new s3.Bucket(this, 'SiteBucket', {
    //   blockPublicAccess: new s3.BlockPublicAccess({
    //     blockPublicAcls: false, blockPublicPolicy: false,
    //     ignorePublicAcls: false, restrictPublicBuckets: false,
    //   }),
    //   publicReadAccess: true,
    //   encryption: s3.BucketEncryption.S3_MANAGED,
    //   enforceSSL: true,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    //   autoDeleteObjects: true,
    // });

    // ---- C) LOCKED (default/baseline): private, both checks pass --------
    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ┌──────────────────────────────────────────────────────────────────┐
    // │ DEMO TOGGLE — PHASE 3b  (EXPRESS MODE: broader infra change)       │
    // │                                                                    │
    // │ WHY THIS PROVES EXPRESS: this changes the CloudFront DISTRIBUTION   │
    // │ (adds error responses). That is a CloudFormation change — hotswap   │
    // │ CANNOT do it. And CloudFront is the canonical slow-to-stabilize     │
    // │ resource: a normal deploy makes you wait for it to re-propagate.    │
    // │ With --express, CloudFormation reports the update complete as soon  │
    // │ as the config is applied, skipping that stabilization wait — so the │
    // │ SAME change returns far faster. The speed delta IS the proof.       │
    // │                                                                    │
    // │ Comment V1, uncomment V2, then:                                     │
    // │   npm run build                                                     │
    // │   cdk deploy SkipTheWait-FeedbackWall --express --require-approval never │
    // │ (To feel the contrast, first deploy V2 WITHOUT --express and time   │
    // │  it, then revert and redeploy WITH --express.)                      │
    // │ V2 adds SPA-style error responses (404/403 -> index.html).         │
    // └──────────────────────────────────────────────────────────────────┘

    // ---- V1 (default) ---------------------------------------------------
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      comment: 'CDK Booth Feedback Wall (DevCon 2026)',
    });
    // ---------------------------------------------------------------------

    // ---- V2 (express deploy): adds SPA-style error responses ------------
    // this.distribution = new cloudfront.Distribution(this, 'Distribution', {
    //   defaultRootObject: 'index.html',
    //   defaultBehavior: {
    //     origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
    //     viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    //     cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    //   },
    //   comment: 'CDK Booth Feedback Wall (DevCon 2026) — express update',
    //   errorResponses: [
    //     { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
    //     { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
    //   ],
    // });
    // ---------------------------------------------------------------------

    // Deploy the static assets, plus a generated config.js carrying the API URL.
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', 'frontend')),
        s3deploy.Source.data(
          'config.js',
          `window.FEEDBACK_API = ${JSON.stringify(props.apiUrl)};\n` +
            `window.SESSION_INSIGHTS = ${JSON.stringify(props.sessionInsights)};`,
        ),
      ],
    });

    this.url = `https://${this.distribution.distributionDomainName}`;
  }
}
