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
 * construct. 
 *
 */
export interface FeedbackWallStackProps extends cdk.StackProps {
  /**
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
