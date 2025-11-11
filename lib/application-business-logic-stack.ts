import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';  
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import { ApplicationCoreStack } from './application-core-stack';
import { ApplicationStorageStack } from './application-storage-stack';

export interface ApplicationBusinessLogicStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
  coreStack: ApplicationCoreStack;  
  storageStack: ApplicationStorageStack;
}

export class ApplicationBusinessLogicStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApplicationBusinessLogicStackProps) {
    super(scope, id, props);

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: props.coreStack.vpc,
      description: `${props.appConfig.name}-lambda-security-group-${props.envConfig.name}`,
    });

    // Create the Lambda function
    const lambdaFunction = new lambda.Function(this, 'LambdaFunction', {
      functionName: `${props.appConfig.name}-lambda-function-${props.envConfig.name}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src-backend/sample-lambda'),
      timeout: cdk.Duration.seconds(300), // Aligned with the SQS queue visibility timeout
      environment: {
        ACCOUNT_ID: props.envConfig.account,
        COGNITO_USER_POOL_ID: props.storageStack.cognitoUserPool.userPoolId,
        COGNITO_IDENTITY_POOL_ID: props.storageStack.cognitoIdentityPool.ref,
        COGNITO_USER_POOL_CLIENT_ID: props.storageStack.userPoolClient.userPoolClientId,
        COGNITO_REGION: props.envConfig.region,
        COGNITO_DOMAIN: props.envConfig.cloudFront.domainName,
      },
      securityGroups: [lambdaSecurityGroup],
      vpc: props.coreStack.vpc,
      vpcSubnets: {
        subnets: props.coreStack.vpc.privateSubnets,
      },
      logGroup: props.storageStack.sampleLambdaLogGroup
    });

    lambdaFunction.addEventSource(new SqsEventSource(props.storageStack.s3SqsQueue));

    props.storageStack.s3Bucket.grantReadWrite(lambdaFunction);
    props.storageStack.dynamodbTable.grantReadWriteData(lambdaFunction);

    // Create the ECS service
    const containerImage = ecs.ContainerImage.fromAsset('src-backend/sample-container');

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.coreStack.vpc,
      description: `${props.appConfig.name}-security-group-${props.envConfig.name}`,
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `${props.appConfig.name}-task-role-${props.envConfig.name}`,
    });

    props.storageStack.s3Bucket.grantReadWrite(taskRole);
    props.storageStack.dynamodbTable.grantReadWriteData(taskRole);

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster: props.coreStack.ecsCluster,
      taskImageOptions: {
        image: containerImage,
        containerPort: 8000,
        environment: {
          ACCOUNT_ID: props.envConfig.account,
          COGNITO_USER_POOL_ID: props.storageStack.cognitoUserPool.userPoolId,
          COGNITO_IDENTITY_POOL_ID: props.storageStack.cognitoIdentityPool.ref,
          COGNITO_USER_POOL_CLIENT_ID: props.storageStack.userPoolClient.userPoolClientId,
          COGNITO_REGION: props.envConfig.region,
          COGNITO_DOMAIN: props.envConfig.cloudFront.domainName,
        },
        taskRole: taskRole,
        logDriver: ecs.LogDriver.awsLogs({
          logGroup: props.storageStack.sampleEcsServiceLogGroup,
          streamPrefix: 'sample-ecs-service',
        }),
      },
      serviceName: `${props.appConfig.name}-service-${props.envConfig.name}`,
      taskSubnets: {
        subnets: props.coreStack.vpc.privateSubnets,
      },
      publicLoadBalancer: true,
      securityGroups: [securityGroup]
    });

    service.targetGroup.configureHealthCheck({
      path: '/health',
    });

  }
}
