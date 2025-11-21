import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import { ApplicationCoreStack } from './application-core-stack';
import { MigrationStorageStack } from './migration-storage-stack';
import { MigrationBusinessLogicStack } from './migration-business-logic-stack';
import { migrationConfig } from './config/migration-config';

export interface PipelineAppStageProps extends cdk.StageProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
}

export class PipelineAppStage extends cdk.Stage {

  constructor(scope: Construct, id: string, props: PipelineAppStageProps) {
    super(scope, id, props);

    // Core infrastructure stack (VPC)
    const coreStack = new ApplicationCoreStack(this, 'ApplicationCoreStack', {
      appConfig: props.appConfig,
      envConfig: props.envConfig,
      env: {
        account: props.envConfig.account,
        region: props.envConfig.region,
      }
    });

    // Unified storage stack (combines application and migration storage)
    const storageStack = new MigrationStorageStack(this, 'MigrationStorageStack', {
      appConfig: props.appConfig,
      envConfig: props.envConfig,
      migrationConfig: migrationConfig,
      coreStack: coreStack,
      env: {
        account: props.envConfig.account,
        region: props.envConfig.region,
      }
    });

    // Unified business logic stack (combines application and migration logic)
    new MigrationBusinessLogicStack(this, 'MigrationBusinessLogicStack', {
      appConfig: props.appConfig,
      envConfig: props.envConfig,
      migrationConfig: migrationConfig,
      coreStack: coreStack,
      storageStack: storageStack,
      env: {
        account: props.envConfig.account,
        region: props.envConfig.region,
      }
    });
  }
}
