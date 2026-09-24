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
 * The app ships a Session Insights panel, powered by the SessionAnalytics
 * construct. That construct is part of the BASE app (on by default) — and it is
 * deliberately slow to synthesize (a duplicated-work bug). That is the Phase 1
 * story: `cdk synth` is slow out of the box, the cdk-synth-performance skill
 * finds the bottleneck, you fix it, synth gets fast.
 *
 * Each collaborator lives in its own construct file:
 *   - constructs/api.ts       Phase 3 hotswap target (Lambda code)
 *   - constructs/website.ts   Phase 3 express-mode target (broader infra)
 *   - constructs/analytics.ts Phase 1 slow-synth bottleneck (Session Insights)
 */
export interface FeedbackWallStackProps extends cdk.StackProps {
  /**
   * Include the SessionAnalytics construct (the Session Insights panel + the
   * Phase 1 slow-synth bottleneck). ON by default so the base app shows the
   * inefficiency from the start. Pass `-c includeAnalytics=false` to drop it
   * (e.g. to show the fast baseline for contrast).
   *
   * @default true
   */
  readonly includeAnalytics?: boolean;
}

export class FeedbackWallStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FeedbackWallStackProps = {}) {
    super(scope, id, props);

    const includeAnalytics = props.includeAnalytics ?? true;

    const database = new ReactionsDatabase(this, 'Reactions');

    const api = new ReactionsApi(this, 'Api', {
      table: database.table,
    });

    // Phase 1: the Session Insights data is precomputed here at synth time.
    // See constructs/analytics.ts for the (deliberate) duplicated-work bug.
    const analytics = includeAnalytics
      ? new SessionAnalytics(this, 'Analytics')
      : undefined;

    const website = new FeedbackWebsite(this, 'Website', {
      apiUrl: api.url,
      sessionInsights: analytics?.insights ?? [],
    });

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
