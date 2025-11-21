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

    // Create AppFlow connection profile for Salesforce
    const salesforceConnectorProfile = new appflow.CfnConnectorProfile(this, 'SalesforceConnectionProfile', {
      connectorProfileName: `${appConfig.name}-salesforce-connection-profile-${envConfig.name}`,
      connectorType: 'Salesforce',
      connectionMode: 'Public',
      connectorProfileConfig: {
        connectorProfileProperties: {
          salesforce: {
            instanceUrl: envConfig.salesforce.instanceUrl,
            isSandboxEnvironment: false,
          },
        },
      },
    });

    // Create AppFlow resources for each customer (regular sync flows)
    appConfig.customers.forEach((customer) => {
      
      // Create AppFlow flows for each Salesforce object (regular sync)
      appConfig.appFlowConfig.objectsToTransfer.forEach((objectToTransfer) => {
       
        const flow = new appflow.CfnFlow(this, `AppFlowFlow-${customer.customerId}-${objectToTransfer.sourceObject}`, {
          flowName: `${appConfig.name}-${customer.customerId}-${objectToTransfer.sourceObject}-${envConfig.name}`.toLowerCase(),
          description: `Sync ${objectToTransfer.sourceObject} from Salesforce to s3 bucket for customer ${customer.name}`,
          triggerConfig: {
            triggerType: 'Scheduled',
            triggerProperties: {
              scheduleExpression: appConfig.appFlowConfig.scheduleExpression,
              dataPullMode: 'Incremental',
              scheduleStartTime: Date.now() / 1000,
            },
          },
          sourceFlowConfig: {
            connectorType: 'Salesforce',
            connectorProfileName: salesforceConnectorProfile.connectorProfileName,
            sourceConnectorProperties: {
              salesforce: {
                object: objectToTransfer.sourceObject,
                enableDynamicFieldUpdate: false,
                includeDeletedRecords: false,
              },
            },
          },
          destinationFlowConfigList: [{
            connectorType: 'S3',
            connectorProfileName: salesforceConnectorProfile.connectorProfileName,
            destinationConnectorProperties: {
              s3: {
                bucketName: storageStack.rawDataBucket.bucketName,
                s3OutputFormatConfig: {
                  fileType: 'JSON',
                  aggregationConfig: {
                    aggregationType: 'SingleFile',
                  },
                },
              },
            },
            
          }],
          tasks: [{
            taskType: 'Map_all',
            sourceFields: [], // Must be an empty list for Map_all
            taskProperties: [{
              // This must be an empty object
              key: '',
              value: '',
            }],
          }],
        });

        flow.addDependency(salesforceConnectorProfile);
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
      env: {
        account: envConfig.account,
        region: envConfig.region,
      }
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
      env: {
        account: envConfig.account,
        region: envConfig.region,
      }
    });

    // Migration Step Functions Stack
    this.migrationStepFunctionsStack = new MigrationStepFunctionsStack(this, 'MigrationStepFunctionsStack', {
      appConfig: appConfig,
      migrationConfig: migrationConfig,
      environment: envConfig.name,
      glueStack: this.migrationGlueStack,
      appFlowStack: this.migrationAppFlowStack,
      env: {
        account: envConfig.account,
        region: envConfig.region,
      }
    });

    // Migration Monitoring Stack
    this.migrationMonitoringStack = new MigrationMonitoringStack(this, 'MigrationMonitoringStack', {
      appConfig: appConfig,
      environment: envConfig.name,
      stepFunctionsStack: this.migrationStepFunctionsStack,
      glueStack: this.migrationGlueStack,
      env: {
        account: envConfig.account,
        region: envConfig.region,
      }
    });
  }
}

