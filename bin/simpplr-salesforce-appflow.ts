#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { appConfig } from '../lib/config/app-config';

const app = new cdk.App();

const deploymentBranch = process.env.SIMPPPLR_SALESFORCE_APPFLOW_DEPLOYMENT_BRANCH;
if (!deploymentBranch) {
  throw new Error('SIMPPPLR_SALESFORCE_APPFLOW_DEPLOYMENT_BRANCH environment variable is not set');
}

if (deploymentBranch === 'main') {
  const stackEnv = { account: appConfig.pipeline.account, region: appConfig.pipeline.region };
  console.log('Deploying pipeline stack for main branch');
  console.log(stackEnv);
  console.log(appConfig.pipeline);
  // Deploy the pipeline stack
  new PipelineStack(app, 'SimpplrSalesforceAppflowPipelineStack', {
    stackName: `${appConfig.name}-pipeline-stack`,
    appConfig: appConfig,
    sandboxPipeline: false,
    sandboxConfig: null,
    env: stackEnv,
  });
} else {

  const sandboxEnvironment = appConfig.sandboxEnvironments.find(environment => environment.pipelineConfig.branch === deploymentBranch);
  if (!sandboxEnvironment) {
    throw new Error(`Sandbox environment not found for branch ${deploymentBranch}`);
  }
  const stackEnv = { account: sandboxEnvironment.environmentConfig.account, region: sandboxEnvironment.environmentConfig.region };
  console.log(`Deploying sandbox pipeline stack for branch ${deploymentBranch}`);
  console.log(stackEnv);
  console.log(sandboxEnvironment.pipelineConfig);
  // Deploy the sandbox pipeline stack
  new PipelineStack(app, `SalesforceMigrationSandboxPipelineStack-${deploymentBranch}`, {
    stackName: `${appConfig.name}-sandbox-pipeline-stack-${deploymentBranch}`,
    appConfig: appConfig,
    sandboxPipeline: true,
    sandboxConfig: sandboxEnvironment,
    env: stackEnv,
  });
}


