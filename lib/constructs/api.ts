import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * The reactions API: a Node.js Lambda behind a REST API Gateway.
 *
 * >>> This is the Phase 3 HOTSWAP target. <<<
 * The handler is plain JS in lambda/reactions (no bundling), so editing it and
 * running `cdk deploy --hotswap` updates the function through the Lambda
 * UpdateFunctionCode API directly — no CloudFormation cycle, seconds not minutes.
 */
export interface ReactionsApiProps {
  /** The table the handler reads and writes. */
  readonly table: dynamodb.Table;
}

export class ReactionsApi extends Construct {
  /** The Lambda that serves the API (the hotswap target). */
  public readonly handler: lambda.Function;

  /** The REST API in front of the Lambda. */
  public readonly restApi: apigw.LambdaRestApi;

  /** The invoke URL of the API (has a trailing slash). */
  public readonly url: string;

  constructor(scope: Construct, id: string, props: ReactionsApiProps) {
    super(scope, id);

    this.handler = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      // Directory asset: the JS is uploaded as-is. No esbuild, no compile step
      // between an edit and a hotswap.
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda', 'reactions')),
      environment: {
        TABLE_NAME: props.table.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      // Explicit log group (the deprecated `logRetention` prop is avoided).
      logGroup: new logs.LogGroup(this, 'HandlerLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    props.table.grantReadWriteData(this.handler);

    this.restApi = new apigw.LambdaRestApi(this, 'RestApi', {
      handler: this.handler,
      restApiName: 'CDK Booth Feedback API',
      description: 'Reactions API for the DevCon 2026 feedback wall.',
      // The static site lives on a different origin (CloudFront); allow it.
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type'],
      },
      deployOptions: {
        stageName: 'prod',
      },
      // The handler itself does the routing, so proxy everything to it.
      proxy: true,
    });

    this.url = this.restApi.url;
  }
}
