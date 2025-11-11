import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as appflow from 'aws-cdk-lib/aws-appflow';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
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

    // Create the sample Lambda function (S3 event processor)
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

    // Create AppFlow service role
    const appFlowServiceRole = new iam.Role(this, 'AppFlowServiceRole', {
      roleName: `${props.appConfig.name}-appflow-service-role-${props.envConfig.name}`,
      assumedBy: new iam.ServicePrincipal('appflow.amazonaws.com'),
      description: 'Service role for AppFlow to access Salesforce and invoke Lambda functions',
    });

    // Create AppFlow resources for each customer
    props.appConfig.customers.forEach((customer) => {
      // Create transformation Lambda for this customer
      const transformLambda = new lambda.Function(this, `TransformLambda-${customer.customerId}`, {
        functionName: `${props.appConfig.name}-appflow-transform-${customer.customerId}-${props.envConfig.name}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('src-backend/sample-lambda'), // Using sample-lambda as the transform function
        timeout: cdk.Duration.minutes(15), // Max timeout for AppFlow Lambda tasks
        environment: {
          CUSTOMER_ID: customer.customerId,
          SALESFORCE_ORG_ID: customer.salesforceOrgId,
        },
        description: `AppFlow transformation Lambda for customer ${customer.name}`,
      });

      // Grant AppFlow service role permission to invoke the transformation Lambda
      transformLambda.grantInvoke(appFlowServiceRole);

      // Grant Lambda access to RDS secret
      const rdsSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        `RDSSecret-${customer.customerId}`,
        customer.rdsConfig.secretArn
      );
      rdsSecret.grantRead(transformLambda);

      // Create AppFlow connector profile for Salesforce (one per customer)
      const salesforceConnectorProfile = new appflow.CfnConnectorProfile(this, `SalesforceConnector-${customer.customerId}`, {
        connectorProfileName: `${props.appConfig.salesforce.connectionProfileName}-${customer.customerId}-${props.envConfig.name}`,
        connectorType: 'Salesforce',
        connectionMode: 'Public',
        connectorProfileConfig: {
          connectorProfileCredentials: {
            salesforce: {
              // OAuth credentials must be configured manually via AWS Console or CLI
              // This requires manual setup of Salesforce connected app and OAuth flow
              accessToken: 'PLACEHOLDER', // Will be updated after manual OAuth setup
              refreshToken: 'PLACEHOLDER', // Will be updated after manual OAuth setup
              clientCredentialsArn: 'PLACEHOLDER', // Optional: ARN of secret containing client ID and secret
            },
          },
          connectorProfileProperties: {
            salesforce: {
              instanceUrl: props.appConfig.salesforce.instanceUrl,
              isSandboxEnvironment: false,
            },
          },
        },
      });

      // Create AppFlow flows for each Salesforce object
      customer.appFlowConfig.transformations.forEach((transformation) => {
        // Create connector profile for RDS destination
        const rdsConnectorProfile = new appflow.CfnConnectorProfile(this, `RDSConnector-${customer.customerId}-${transformation.sourceObject}`, {
          connectorProfileName: `rds-${customer.customerId}-${transformation.sourceObject}-${props.envConfig.name}`.toLowerCase(),
          connectorType: 'CustomConnector', // RDS uses custom connector
          connectionMode: 'Private',
          connectorProfileConfig: {
            connectorProfileCredentials: {
              customConnector: {
                authenticationType: 'CUSTOM',
                custom: {
                  customAuthenticationType: 'custom',
                  credentialsMap: {
                    username: rdsSecret.secretValueFromJson('username').unsafeUnwrap(),
                    password: rdsSecret.secretValueFromJson('password').unsafeUnwrap(),
                  },
                },
              },
            },
            connectorProfileProperties: {
              customConnector: {
                profileProperties: {
                  host: customer.rdsConfig.host,
                  port: customer.rdsConfig.port.toString(),
                  database: customer.rdsConfig.database,
                },
              },
            },
          },
        });

        // Build field mapping tasks
        const fieldMappingTasks: appflow.CfnFlow.TaskProperty[] = transformation.fieldMappings.map(mapping => ({
          taskType: 'Map',
          sourceFields: [mapping.source],
          taskProperties: [
            {
              key: 'DESTINATION_DATA_TYPE',
              value: 'string',
            },
            {
              key: 'SOURCE_DATA_TYPE',
              value: 'string',
            },
          ],
          connectorOperator: {
            salesforce: 'PROJECTION',
          },
          destinationField: mapping.destination,
        }));

        // Add Lambda transformation task if using CUSTOM_LAMBDA strategy
        if (transformation.multiRecordStrategy === 'CUSTOM_LAMBDA') {
          fieldMappingTasks.push({
            taskType: 'Map',
            sourceFields: ['*'], // All fields
            taskProperties: [
              {
                key: 'LAMBDA_ARN',
                value: transformLambda.functionArn,
              },
            ],
            connectorOperator: {
              salesforce: 'NO_OP',
            },
          });
        }

        // Create AppFlow flow
        const flow = new appflow.CfnFlow(this, `AppFlowFlow-${customer.customerId}-${transformation.sourceObject}`, {
          flowName: `${props.appConfig.name}-${customer.customerId}-${transformation.sourceObject}-${props.envConfig.name}`.toLowerCase(),
          description: `Sync ${transformation.sourceObject} from Salesforce to RDS for customer ${customer.name}`,
          triggerConfig: {
            triggerType: 'Scheduled',
            triggerProperties: {
              scheduleExpression: customer.appFlowConfig.scheduleExpression,
              dataPullMode: 'Incremental',
              scheduleStartTime: Date.now() / 1000, // Start immediately
            },
          },
          sourceFlowConfig: {
            connectorType: 'Salesforce',
            connectorProfileName: salesforceConnectorProfile.connectorProfileName,
            sourceConnectorProperties: {
              salesforce: {
                object: transformation.sourceObject,
                enableDynamicFieldUpdate: false,
                includeDeletedRecords: false,
              },
            },
          },
          destinationFlowConfigList: [
            {
              connectorType: 'CustomConnector',
              connectorProfileName: rdsConnectorProfile.connectorProfileName,
              destinationConnectorProperties: {
                customConnector: {
                  entityName: transformation.destinationTable,
                  errorHandlingConfig: {
                    failOnFirstError: false,
                    bucketName: props.storageStack.s3Bucket.bucketName,
                    bucketPrefix: `appflow-errors/${customer.customerId}/${transformation.sourceObject}`,
                  },
                },
              },
            },
          ],
          tasks: fieldMappingTasks,
        });

        // Add dependency on connector profiles
        flow.addDependency(salesforceConnectorProfile);
        flow.addDependency(rdsConnectorProfile);

        // Tag the flow
        cdk.Tags.of(flow).add('Customer', customer.name);
        cdk.Tags.of(flow).add('CustomerId', customer.customerId);
        cdk.Tags.of(flow).add('SalesforceObject', transformation.sourceObject);
      });
    });
  }
}
