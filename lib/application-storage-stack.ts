import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import { ApplicationCoreStack } from './application-core-stack';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';

export interface ApplicationStorageStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
  coreStack: ApplicationCoreStack;
}

export class ApplicationStorageStack extends cdk.Stack {
  public readonly s3KmsKey: kms.Key;
  public readonly dynamodbKmsKey: kms.Key;
  public readonly s3Bucket: s3.Bucket;
  public readonly s3SqsQueue: sqs.Queue;
  public readonly s3DLQ: sqs.Queue;
  public readonly s3HostingBucket: s3.Bucket;
  public readonly dynamodbTable: dynamodb.Table;
  public readonly cognitoUserPool: cognito.UserPool;
  public readonly cognitoIdentityPool: cognito.CfnIdentityPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly sampleLambdaLogGroup: logs.LogGroup;
  public readonly sampleEcsServiceLogGroup: logs.LogGroup;
  private readonly appConfig: AppConfig;
  private readonly envConfig: EnvironmentConfig;


  constructor(scope: Construct, id: string, props: ApplicationStorageStackProps) {
    super(scope, id, props);

    this.appConfig = props.appConfig;
    this.envConfig = props.envConfig;

    // Create S3 KMS key
    this.s3KmsKey = new kms.Key(this, 'S3KmsKey', {
      alias: `${props.appConfig.name}-s3-kms-key-${props.envConfig.name}`     
    });

    this.s3DLQ = new sqs.Queue(this, 'S3DLQ', {
      queueName: `${props.appConfig.name}-s3-dlq-${props.envConfig.name}`,
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    this.s3SqsQueue = new sqs.Queue(this, 'S3SqsQueue', {
      queueName: `${props.appConfig.name}-s3-sqs-queue-${props.envConfig.name}`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: this.s3DLQ,
        maxReceiveCount: 3,
      },
    });
    
    // The code that defines your stack goes here
    // Create S3 bucket
    this.s3Bucket = new s3.Bucket(this, 'S3Bucket', {
      bucketName: `${props.appConfig.name}-s3-bucket-${props.envConfig.name}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.s3KmsKey
    });

    this.s3Bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(this.s3SqsQueue));

    this.sampleLambdaLogGroup = new logs.LogGroup(this, 'sampleLambdaLogGroup', {
      logGroupName: `/aws/lambda/${props.appConfig.name}-lambda-function-${props.envConfig.name}`,
    });


  }
}
