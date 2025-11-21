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
      stackName: `${appConfig.name}-migration-appflow-${envConfig.name}`,
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
      stackName: `${appConfig.name}-migration-glue-${envConfig.name}`,
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
      stackName: `${appConfig.name}-migration-stepfunctions-${envConfig.name}`,
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
      stackName: `${appConfig.name}-migration-monitoring-${envConfig.name}`,
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

