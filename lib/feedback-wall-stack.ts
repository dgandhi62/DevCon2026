import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ReactionsDatabase } from './constructs/database';
import { ReactionsApi } from './constructs/api';
import { FeedbackWebsite } from './constructs/website';
import { SessionAnalytics } from './constructs/analytics';

/**
 * The real, working app: the CDK Booth Feedback Wall.
 *
 *   DynamoDB (reactions)  <-  Lambda  <-  API Gateway  <-  CloudFront + S3 site
 *
 * Each collaborator lives in its own construct file so the demo can open one
 * file per phase:
 *   - constructs/api.ts       Phase 3 hotswap target (Lambda code)
 *   - constructs/website.ts   Phase 3 express-mode target (broader infra)
 *   - constructs/analytics.ts Phase 1 slow-synth bottleneck (opt-in)
 */
export interface FeedbackWallStackProps extends cdk.StackProps {
  /**
   * Include the (deliberately slow) SessionAnalytics construct. This is what
   * the Phase 1 synth-performance demo investigates. Off by default so the
   * everyday app synthesizes fast; turn it on for the Phase 1 walkthrough.
   *
   * @default false
   */
  readonly includeAnalytics?: boolean;
}

export class FeedbackWallStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FeedbackWallStackProps = {}) {
    super(scope, id, props);

    const database = new ReactionsDatabase(this, 'Reactions');

    const api = new ReactionsApi(this, 'Api', {
      table: database.table,
    });

    const website = new FeedbackWebsite(this, 'Website', {
      apiUrl: api.url,
    });

    // Phase 1: opt-in slow construct. See constructs/analytics.ts.
    if (props.includeAnalytics) {
      new SessionAnalytics(this, 'Analytics', {
        table: database.table,
      });
    }

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Reactions API invoke URL',
    });

    new cdk.CfnOutput(this, 'WallUrl', {
      value: website.url,
      description: 'Public URL of the feedback wall',
    });
  }
}
