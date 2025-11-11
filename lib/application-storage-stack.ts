import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
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
  public readonly cloudFrontDistribution: cloudfront.Distribution;
  public readonly sampleLambdaLogGroup: logs.LogGroup;
  public readonly sampleEcsServiceLogGroup: logs.LogGroup;
  private readonly appConfig: AppConfig;
  private readonly envConfig: EnvironmentConfig;

  private buildCloudFrontDistribution(bucket: s3.Bucket): cloudfront.Distribution {

    // Create Origin Access Control for CloudFront-S3 authentication
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      originAccessControlName: `${this.appConfig.name}-oac-${this.envConfig.name}`,
      description: `Origin Access Control for ${this.appConfig.name} static hosting`,
    });

    // Create CloudFront distribution
    const cloudFrontDistribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket, {
          originAccessControlId: oac.originAccessControlId,
        })
      },
      defaultRootObject: 'index.html',
    });

    // Update S3 bucket policy to allow CloudFront OAC access
    bucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${cloudFrontDistribution.distributionId}`,
          },
        },
      })
    );

    return cloudFrontDistribution;
  }

  constructor(scope: Construct, id: string, props: ApplicationStorageStackProps) {
    super(scope, id, props);

    this.appConfig = props.appConfig;
    this.envConfig = props.envConfig;

    // Create S3 KMS key
    this.s3KmsKey = new kms.Key(this, 'S3KmsKey', {
      alias: `${props.appConfig.name}-s3-kms-key-${props.envConfig.name}`     
    });

    this.dynamodbKmsKey = new kms.Key(this, 'DynamoDBKmsKey', {
      alias: `${props.appConfig.name}-dynamodb-kms-key-${props.envConfig.name}`     
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

    this.sampleEcsServiceLogGroup = new logs.LogGroup(this, 'sampleEcsServiceLogGroup', {
      logGroupName: `/aws/ecs/sample-ecs-service-${props.envConfig.name}`,
    });

    // Add Google OAuth identity provider if configured
    let googleProvider: cognito.UserPoolIdentityProviderGoogle | undefined;
    let googleFound = false;
    // if (props.envConfig.cognito?.googleOAuth) {
    //   googleFound = true;
    //   googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdentityProvider', {
    //     userPool: this.cognitoUserPool,
    //     clientId: props.envConfig.cognito.googleOAuth.clientId,
    //     clientSecret: props.envConfig.cognito.googleOAuth.clientSecret,
    //     scopes: props.envConfig.cognito.googleOAuth.scopes,
    //     attributeMapping: {
    //       email: cognito.ProviderAttribute.GOOGLE_EMAIL,
    //       givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
    //       familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
    //     },
    //   });
    // }

    // Create Cognito user pool
    this.cognitoUserPool = new cognito.UserPool(this, 'CognitoUserPool', {
      userPoolName: `${props.appConfig.name}-cognito-user-pool-${props.envConfig.name}`,
      signInAliases: {
        email: true,
      }
    });
    // Create user pool client with Google OAuth support if configured
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.cognitoUserPool,
      userPoolClientName: `${props.appConfig.name}-user-pool-client-${props.envConfig.name}`,
      generateSecret: false, // Required for OAuth flows
      supportedIdentityProviders: googleFound ? [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ] : undefined,
      oAuth: googleFound ? {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          'https://localhost:3000/callback', // Add your frontend callback URL
          `https://${props.envConfig.cloudFront.domainName}/callback`,
        ],
        logoutUrls: [
          'https://localhost:3000/logout', // Add your frontend logout URL
          `https://${props.envConfig.cloudFront.domainName}/logout`,
        ],
      } : undefined,
    });

    
    if (googleFound && googleProvider) {
      // Ensure that the identity provider is created before the user pool client
      this.userPoolClient.node.addDependency(googleProvider);
    }
    
    // Create IAM roles for authenticated and unauthenticated users
    const authenticatedRole = new cdk.aws_iam.Role(this, 'CognitoAuthenticatedRole', {
      assumedBy: new cdk.aws_iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        'StringEquals': {
          'cognito-identity.amazonaws.com:aud': '', // Will be set after identity pool creation
        },
        'ForAnyValue:StringLike': {
          'cognito-identity.amazonaws.com:amr': 'authenticated',
        },
      }, 'sts:AssumeRoleWithWebIdentity'),
    });

    const unauthenticatedRole = new cdk.aws_iam.Role(this, 'CognitoUnauthenticatedRole', {
      assumedBy: new cdk.aws_iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        'StringEquals': {
          'cognito-identity.amazonaws.com:aud': '', // Will be set after identity pool creation
        },
        'ForAnyValue:StringLike': {
          'cognito-identity.amazonaws.com:amr': 'unauthenticated',
        },
      }, 'sts:AssumeRoleWithWebIdentity'),
    });

    // Create Cognito Identity Pool with Google OAuth support
    const identityPoolProviders: cognito.CfnIdentityPool.CognitoIdentityProviderProperty[] = [
      {
        clientId: this.userPoolClient.userPoolClientId,
        providerName: this.cognitoUserPool.userPoolProviderName,
      },
    ];

    this.cognitoIdentityPool = new cognito.CfnIdentityPool(this, 'CognitoIdentityPool', {
      identityPoolName: `${props.appConfig.name}-cognito-identity-pool-${props.envConfig.name}`,
      allowUnauthenticatedIdentities: true,
      cognitoIdentityProviders: identityPoolProviders,
    });

    // Update the IAM role trust policies with the identity pool ID
    authenticatedRole.assumeRolePolicy?.addStatements(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
          'StringEquals': {
            'cognito-identity.amazonaws.com:aud': this.cognitoIdentityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        }, 'sts:AssumeRoleWithWebIdentity')],
        actions: ['sts:AssumeRoleWithWebIdentity'],
      })
    );

    unauthenticatedRole.assumeRolePolicy?.addStatements(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
          'StringEquals': {
            'cognito-identity.amazonaws.com:aud': this.cognitoIdentityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'unauthenticated',
          },
        }, 'sts:AssumeRoleWithWebIdentity')],
        actions: ['sts:AssumeRoleWithWebIdentity'],
      })
    );

    // Attach roles to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'CognitoIdentityPoolRoleAttachment', {
      identityPoolId: this.cognitoIdentityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
        unauthenticated: unauthenticatedRole.roleArn,
      },
    });

    this.s3HostingBucket = new s3.Bucket(this, 'S3HostingBucket', {
      bucketName: `${props.appConfig.name}-s3-hosting-bucket-${props.envConfig.name}`      
    });
    
    this.cloudFrontDistribution = this.buildCloudFrontDistribution(this.s3HostingBucket);

    // Create DynamoDB table
    this.dynamodbTable = new dynamodb.Table(this, 'DynamoDBTable', {
      tableName: `${props.appConfig.name}-dynamodb-table-${props.envConfig.name}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.dynamodbKmsKey,
    });

  }
}
