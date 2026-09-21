import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * The reactions table for the feedback wall.
 *
 * One row per reaction: { id, name, message, mood, votes, createdAt }.
 * Partition key is `id`; the wall reads the whole (small) table and sorts in
 * the Lambda, so no secondary indexes are needed.
 *
 * Pay-per-request keeps it zero-config for a booth: no capacity to provision,
 * no scaling to think about. Removal policy is DESTROY so the booth stack tears
 * down cleanly.
 */
export class ReactionsDatabase extends Construct {
  /** The DynamoDB table holding reactions. */
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
    });
  }
}
