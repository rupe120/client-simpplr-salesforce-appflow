import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';  
import * as ec2 from 'aws-cdk-lib/aws-ec2';
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


  }
}
