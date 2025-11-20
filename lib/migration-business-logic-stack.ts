import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import { MigrationConfig } from './config/migration-config';
import { ApplicationCoreStack } from './application-core-stack';
import { MigrationStorageStack } from './migration-storage-stack';
import { MigrationAppFlowStack } from './migration-appflow-stack';
import { MigrationGlueStack } from './migration-glue-stack';
import { MigrationStepFunctionsStack } from './migration-stepfunctions-stack';
import { MigrationMonitoringStack } from './migration-monitoring-stack';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as appflow from 'aws-cdk-lib/aws-appflow';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface MigrationBusinessLogicStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
  migrationConfig: MigrationConfig;
  coreStack: ApplicationCoreStack;
  storageStack: MigrationStorageStack;
}

/**
 * Migration Business Logic Stack
 * Combines application business logic (Lambda, AppFlow for regular sync) 
 * with migration logic (Glue, Step Functions, Migration AppFlow)
 */
export class MigrationBusinessLogicStack extends cdk.Stack {
  // Application resources
  public readonly appFlowServiceRole: iam.Role;
  public readonly rdsDbInitLambda: lambda.Function;

  // Migration resources
  public readonly migrationAppFlowStack: MigrationAppFlowStack;
  public readonly migrationGlueStack: MigrationGlueStack;
  public readonly migrationStepFunctionsStack: MigrationStepFunctionsStack;
  public readonly migrationMonitoringStack: MigrationMonitoringStack;

  constructor(scope: Construct, id: string, props: MigrationBusinessLogicStackProps) {
    super(scope, id, props);

    const { appConfig, envConfig, migrationConfig, coreStack, storageStack } = props;

    // ============================================
    // Application Business Logic
    // ============================================

    // AppFlow service role
    this.appFlowServiceRole = new iam.Role(this, 'AppFlowServiceRole', {
      roleName: `${appConfig.name}-appflow-service-role-${envConfig.name}`,
      assumedBy: new iam.ServicePrincipal('appflow.amazonaws.com'),
      description: 'Service role for AppFlow to access Salesforce and invoke Lambda functions',
    });

    // RDS database initialization Lambda
    const rdsDbInitSecurityGroup = new ec2.SecurityGroup(this, 'RdsDbInitSecurityGroup', {
      vpc: coreStack.vpc,
      description: `${appConfig.name}-rds-db-init-sg-${envConfig.name}`,
      allowAllOutbound: true,
    });

    // Create log group for RDS init Lambda
    const rdsDbInitLogGroup = new logs.LogGroup(this, 'RdsDbInitLogGroup', {
      logGroupName: `/aws/lambda/${appConfig.name}-rds-db-init-${envConfig.name}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    this.rdsDbInitLambda = new lambda.Function(this, 'RdsDbInitLambda', {
      functionName: `${appConfig.name}-rds-db-init-${envConfig.name}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src-backend/rds-database-init'),
      timeout: cdk.Duration.minutes(5),
      vpc: coreStack.vpc,
      vpcSubnets: {
        subnets: coreStack.vpc.privateSubnets,
      },
      securityGroups: [rdsDbInitSecurityGroup],
      description: 'Custom resource Lambda to initialize RDS databases for customers',
      logGroup: rdsDbInitLogGroup,
    });

    // Create log group for custom resource provider
    const rdsDbInitProviderLogGroup = new logs.LogGroup(this, 'RdsDbInitProviderLogGroup', {
      logGroupName: `/aws/lambda/${appConfig.name}-rds-db-init-provider-${envConfig.name}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create custom resource provider
    const rdsDbInitProvider = new cr.Provider(this, 'RdsDbInitProvider', {
      onEventHandler: this.rdsDbInitLambda,
      logGroup: rdsDbInitProviderLogGroup,
    });

    // Create AppFlow resources for each customer (regular sync flows)
    appConfig.customers.forEach((customer) => {
      // Create transformation Lambda for this customer (if CUSTOM_LAMBDA strategy is used)
      // Note: Update code path to actual transformation Lambda when implemented
      const transformLambda = new lambda.Function(this, `TransformLambda-${customer.customerId}`, {
        functionName: `${appConfig.name}-appflow-transform-${customer.customerId}-${envConfig.name}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('src-backend/rds-database-init'), // Placeholder - update to actual transform code
        timeout: cdk.Duration.minutes(15),
        environment: {
          CUSTOMER_ID: customer.customerId,
          SALESFORCE_ORG_ID: customer.salesforceOrgId,
        },
        description: `AppFlow transformation Lambda for customer ${customer.name}`,
      });

      transformLambda.grantInvoke(this.appFlowServiceRole);

      // Grant Lambda access to RDS secret
      const rdsSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        `RDSSecret-${customer.customerId}`,
        customer.rdsConfig.secretArn
      );
      rdsSecret.grantRead(transformLambda);
      rdsSecret.grantRead(this.rdsDbInitLambda);

      // Create custom resource to initialize the database
      const dbInitCustomResource = new cdk.CustomResource(this, `DbInit-${customer.customerId}`, {
        serviceToken: rdsDbInitProvider.serviceToken,
        properties: {
          RdsHost: customer.rdsConfig.host,
          RdsPort: customer.rdsConfig.port,
          DatabaseName: customer.rdsConfig.database,
          SecretArn: customer.rdsConfig.secretArn,
          Engine: customer.rdsConfig.engine,
          CustomerId: customer.customerId,
          Timestamp: Date.now().toString(),
        },
      });

      // Create AppFlow connector profile for Salesforce
      const salesforceConnectorProfile = new appflow.CfnConnectorProfile(this, `SalesforceConnector-${customer.customerId}`, {
        connectorProfileName: `${appConfig.salesforce.connectionProfileName}-${customer.customerId}-${envConfig.name}`,
        connectorType: 'Salesforce',
        connectionMode: 'Public',
        connectorProfileConfig: {
          connectorProfileCredentials: {
            salesforce: {
              accessToken: 'PLACEHOLDER',
              refreshToken: 'PLACEHOLDER',
              clientCredentialsArn: 'PLACEHOLDER',
            },
          },
          connectorProfileProperties: {
            salesforce: {
              instanceUrl: appConfig.salesforce.instanceUrl,
              isSandboxEnvironment: false,
            },
          },
        },
      });

      // Create AppFlow flows for each Salesforce object (regular sync)
      customer.appFlowConfig?.transformations.forEach((transformation) => {
        const rdsConnectorProfile = new appflow.CfnConnectorProfile(this, `RDSConnector-${customer.customerId}-${transformation.sourceObject}`, {
          connectorProfileName: `rds-${customer.customerId}-${transformation.sourceObject}-${envConfig.name}`.toLowerCase(),
          connectorType: 'CustomConnector',
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

        const fieldMappingTasks: appflow.CfnFlow.TaskProperty[] = transformation.fieldMappings.map(mapping => ({
          taskType: 'Map',
          sourceFields: [mapping.source],
          taskProperties: [
            { key: 'DESTINATION_DATA_TYPE', value: 'string' },
            { key: 'SOURCE_DATA_TYPE', value: 'string' },
          ],
          connectorOperator: { salesforce: 'PROJECTION' },
          destinationField: mapping.destination,
        }));

        if (transformation.multiRecordStrategy === 'CUSTOM_LAMBDA') {
          fieldMappingTasks.push({
            taskType: 'Map',
            sourceFields: ['*'],
            taskProperties: [{ key: 'LAMBDA_ARN', value: transformLambda.functionArn }],
            connectorOperator: { salesforce: 'NO_OP' },
          });
        }

        const flow = new appflow.CfnFlow(this, `AppFlowFlow-${customer.customerId}-${transformation.sourceObject}`, {
          flowName: `${appConfig.name}-${customer.customerId}-${transformation.sourceObject}-${envConfig.name}`.toLowerCase(),
          description: `Sync ${transformation.sourceObject} from Salesforce to RDS for customer ${customer.name}`,
          triggerConfig: {
            triggerType: 'Scheduled',
            triggerProperties: {
              scheduleExpression: customer.appFlowConfig.scheduleExpression,
              dataPullMode: 'Incremental',
              scheduleStartTime: Date.now() / 1000,
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
          destinationFlowConfigList: [{
            connectorType: 'CustomConnector',
            connectorProfileName: rdsConnectorProfile.connectorProfileName,
            destinationConnectorProperties: {
              customConnector: {
                entityName: transformation.destinationTable,
                errorHandlingConfig: {
                  failOnFirstError: false,
                  bucketName: storageStack.s3Bucket.bucketName,
                  bucketPrefix: `appflow-errors/${customer.customerId}/${transformation.sourceObject}`,
                },
              },
            },
          }],
          tasks: fieldMappingTasks,
        });

        flow.addDependency(salesforceConnectorProfile);
        flow.addDependency(rdsConnectorProfile);
        flow.node.addDependency(dbInitCustomResource);
      });
    });

    // ============================================
    // Migration Business Logic
    // ============================================

    // Get secrets for migration databases
    const zeusDbSecretName = this.node.tryGetContext('zeusDbSecretName') || 
      `migration-zeus-db-secret-${envConfig.name}`;
    const cdcDbSecretName = this.node.tryGetContext('cdcDbSecretName') || 
      `migration-cdc-db-secret-${envConfig.name}`;

    const zeusDbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ZeusDbSecret',
      zeusDbSecretName
    );

    const cdcDbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'CdcDbSecret',
      cdcDbSecretName
    );

    // Migration AppFlow Stack (for migration data extraction)
    this.migrationAppFlowStack = new MigrationAppFlowStack(this, 'MigrationAppFlowStack', {
      appConfig: appConfig,
      envConfig: envConfig,
      storageStack: storageStack,
    });

    // Migration Glue Stack
    this.migrationGlueStack = new MigrationGlueStack(this, 'MigrationGlueStack', {
      appConfig: appConfig,
      migrationConfig: migrationConfig,
      environment: envConfig.name,
      storageStack: storageStack,
      coreStack: coreStack,
      zeusDbSecret: zeusDbSecret,
      cdcDbSecret: cdcDbSecret,
    });

    // Migration Step Functions Stack
    this.migrationStepFunctionsStack = new MigrationStepFunctionsStack(this, 'MigrationStepFunctionsStack', {
      appConfig: appConfig,
      migrationConfig: migrationConfig,
      environment: envConfig.name,
      glueStack: this.migrationGlueStack,
    });

    // Migration Monitoring Stack
    this.migrationMonitoringStack = new MigrationMonitoringStack(this, 'MigrationMonitoringStack', {
      appConfig: appConfig,
      environment: envConfig.name,
      stepFunctionsStack: this.migrationStepFunctionsStack,
      glueStack: this.migrationGlueStack,
    });
  }
}

