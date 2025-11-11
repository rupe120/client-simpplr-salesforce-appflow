import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApplicationBusinessLogicStack } from './application-business-logic-stack';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import { ApplicationCoreStack } from './application-core-stack';
import { ApplicationStorageStack } from './application-storage-stack';

export interface PipelineAppStageProps extends cdk.StageProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
}

export class PipelineAppStage extends cdk.Stage {

  constructor(scope: Construct, id: string, props: PipelineAppStageProps) {
    super(scope, id, props);

    // Deploy the main application stack

    const coreStack = new ApplicationCoreStack(this, 'ApplicationCoreStack', {
      stackName: `${props.appConfig.name}-application-core-stack`,
      appConfig: props.appConfig,
      envConfig: props.envConfig,
      env: props.env,
    });

    const storageStack = new ApplicationStorageStack(this, 'ApplicationStorageStack', {
      stackName: `${props.appConfig.name}-application-storage-stack`,
      appConfig: props.appConfig,
      envConfig: props.envConfig,
      env: props.env,
      coreStack: coreStack,
    });
    
    new ApplicationBusinessLogicStack(this, 'ApplicationBusinessLogicStack', {
      stackName: `${props.appConfig.name}-application-business-logic-stack`,
      appConfig: props.appConfig,
      envConfig: props.envConfig,
      env: props.env,
      coreStack: coreStack,
      storageStack: storageStack,
    });

  }
}
