import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import { MigrationConfig } from './config/migration-config';
import { ApplicationCoreStack } from './application-core-stack';

export interface MigrationStorageStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
  migrationConfig: MigrationConfig;
  coreStack: ApplicationCoreStack;
}

/**
 * Migration Storage Stack
 * Combines application storage (S3, SQS, Cognito, DynamoDB) with migration storage
 * Creates S3 buckets for raw data, processed data, errors, and scripts
 * Creates DynamoDB tables for Entity Migration Status (EMS) and Tenant Migration Status (TMS)
 */
export class MigrationStorageStack extends cdk.Stack {
  // Application storage resources
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
  public readonly sampleEcsServiceLogGroup: logs.LogGroup;

  // Migration storage resources
  public readonly rawDataBucket: s3.Bucket;
  public readonly processedDataBucket: s3.Bucket;
  public readonly errorDataBucket: s3.Bucket;
  public readonly scriptsBucket: s3.Bucket;
  public readonly tempBucket: s3.Bucket;
  public readonly logsBucket: s3.Bucket;
  public readonly emsTable: dynamodb.Table;
  public readonly tmsTable: dynamodb.Table;
  public readonly migrationS3Key: kms.Key;

  constructor(scope: Construct, id: string, props: MigrationStorageStackProps) {
    super(scope, id, props);

    const { appConfig, envConfig, migrationConfig } = props;
    const stackName = `${appConfig.name}-migration-storage-${envConfig.name}`;

    // Create shared KMS keys
    this.s3KmsKey = new kms.Key(this, 'S3KmsKey', {
      alias: `${appConfig.name}-s3-kms-key-${envConfig.name}`,
      enableKeyRotation: true,
    });

    this.dynamodbKmsKey = new kms.Key(this, 'DynamoDbKmsKey', {
      alias: `${appConfig.name}-dynamodb-kms-key-${envConfig.name}`,
      enableKeyRotation: true,
    });

    this.migrationS3Key = new kms.Key(this, 'MigrationS3Key', {
      description: 'KMS key for migration S3 buckets encryption',
      enableKeyRotation: true,
    });

    // Application S3 bucket and SQS
    this.s3DLQ = new sqs.Queue(this, 'S3DLQ', {
      queueName: `${appConfig.name}-s3-dlq-${envConfig.name}`,
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    this.s3SqsQueue = new sqs.Queue(this, 'S3SqsQueue', {
      queueName: `${appConfig.name}-s3-sqs-queue-${envConfig.name}`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: this.s3DLQ,
        maxReceiveCount: 3,
      },
    });

    this.s3Bucket = new s3.Bucket(this, 'S3Bucket', {
      bucketName: `${appConfig.name}-s3-bucket-${envConfig.name}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.s3KmsKey,
    });

    this.s3Bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(this.s3SqsQueue)
    );

    // Application DynamoDB table
    this.dynamodbTable = new dynamodb.Table(this, 'DynamoDbTable', {
      tableName: `${appConfig.name}-dynamodb-table-${envConfig.name}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.dynamodbKmsKey,
    });

    // Cognito User Pool
    this.cognitoUserPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${appConfig.name}-user-pool-${envConfig.name}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
    });

    this.userPoolClient = this.cognitoUserPool.addClient('UserPoolClient', {
      userPoolClientName: `${appConfig.name}-user-pool-client-${envConfig.name}`,
    });

    this.cognitoIdentityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `${appConfig.name}-identity-pool-${envConfig.name}`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: this.userPoolClient.userPoolClientId,
        providerName: this.cognitoUserPool.userPoolProviderName,
      }],
    });

    // Log groups
    this.sampleEcsServiceLogGroup = new logs.LogGroup(this, 'sampleEcsServiceLogGroup', {
      logGroupName: `/aws/ecs/${appConfig.name}-ecs-service-${envConfig.name}`,
    });

    // S3 Hosting Bucket (for static website hosting if needed)
    this.s3HostingBucket = new s3.Bucket(this, 'S3HostingBucket', {
      bucketName: `${appConfig.name}-hosting-${envConfig.name}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.s3KmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
    });

    // Migration S3 Buckets
    this.rawDataBucket = new s3.Bucket(this, 'RawDataBucket', {
      bucketName: `${stackName}-raw-data`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.migrationS3Key,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'DeleteOldRawData',
        expiration: cdk.Duration.days(migrationConfig.s3.rawDataRetentionDays),
      }],
    });

    // S3 Bucket for processed data
    this.processedDataBucket = new s3.Bucket(this, 'ProcessedDataBucket', {
      bucketName: `${stackName}-processed-data`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.migrationS3Key,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'DeleteOldProcessedData',
        expiration: cdk.Duration.days(migrationConfig.s3.processedDataRetentionDays),
      }],
    });

    // S3 Bucket for error data
    this.errorDataBucket = new s3.Bucket(this, 'ErrorDataBucket', {
      bucketName: `${stackName}-error-data`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.migrationS3Key,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'DeleteOldErrorData',
        expiration: cdk.Duration.days(migrationConfig.s3.errorDataRetentionDays),
      }],
    });

    // S3 Bucket for Glue job scripts
    this.scriptsBucket = new s3.Bucket(this, 'ScriptsBucket', {
      bucketName: `${stackName}-scripts`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.migrationS3Key,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // S3 Bucket for temporary data
    this.tempBucket = new s3.Bucket(this, 'TempBucket', {
      bucketName: `${stackName}-temp`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.migrationS3Key,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'DeleteTempData',
        expiration: cdk.Duration.days(1), // Delete after 1 day
      }],
    });

    // S3 Bucket for Spark logs
    this.logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: `${stackName}-logs`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.migrationS3Key,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'DeleteOldLogs',
        expiration: cdk.Duration.days(30),
      }],
    });

    // DynamoDB Table for Entity Migration Status (EMS)
    this.emsTable = new dynamodb.Table(this, 'EntityMigrationStatus', {
      tableName: `${stackName}-ems`,
      partitionKey: { name: 'org_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'entity_name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Enable point-in-time recovery using CfnTable
    const emsCfnTable = this.emsTable.node.defaultChild as dynamodb.CfnTable;
    emsCfnTable.pointInTimeRecoverySpecification = {
      pointInTimeRecoveryEnabled: true,
    };

    // Add GSI for querying by status
    this.emsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updated_at', type: dynamodb.AttributeType.STRING },
    });

    // DynamoDB Table for Tenant Migration Status (TMS)
    this.tmsTable = new dynamodb.Table(this, 'TenantMigrationStatus', {
      tableName: `${stackName}-tms`,
      partitionKey: { name: 'org_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Enable point-in-time recovery using CfnTable
    const tmsCfnTable = this.tmsTable.node.defaultChild as dynamodb.CfnTable;
    tmsCfnTable.pointInTimeRecoverySpecification = {
      pointInTimeRecoveryEnabled: true,
    };

    // Add GSI for querying by status
    this.tmsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updated_at', type: dynamodb.AttributeType.STRING },
    });

    // Outputs
    new cdk.CfnOutput(this, 'RawDataBucketName', {
      value: this.rawDataBucket.bucketName,
      exportName: `${stackName}-raw-data-bucket`,
    });

    new cdk.CfnOutput(this, 'ProcessedDataBucketName', {
      value: this.processedDataBucket.bucketName,
      exportName: `${stackName}-processed-data-bucket`,
    });

    new cdk.CfnOutput(this, 'EMSTableName', {
      value: this.emsTable.tableName,
      exportName: `${stackName}-ems-table`,
    });

    new cdk.CfnOutput(this, 'TMSTableName', {
      value: this.tmsTable.tableName,
      exportName: `${stackName}-tms-table`,
    });
  }
}

