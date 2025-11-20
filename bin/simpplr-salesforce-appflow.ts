#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { appConfig } from '../lib/config/app-config';

const app = new cdk.App();

const deploymentBranch = process.env.SIMPPPLR_SALESFORCE_APPFLOW_DEPLOYMENT_BRANCH || 'main';

if (deploymentBranch === 'main') {
  // Deploy the pipeline stack
  new PipelineStack(app, 'SimpplrSalesforceAppflowPipelineStack', {
    stackName: `${appConfig.name}-pipeline-stack`,
    appConfig: appConfig,
    sandboxPipeline: false,
    env: { account: appConfig.pipeline.account, region: appConfig.pipeline.region },
  });
} else {

  const sandboxPipeline = appConfig.sandboxPipelines.find(pipeline => pipeline.branch === deploymentBranch);
  if (!sandboxPipeline) {
    throw new Error(`Sandbox pipeline config not found for branch ${deploymentBranch}`);
  }
  // Deploy the sandbox pipeline stack
  new PipelineStack(app, `SalesforceMigrationSandboxPipelineStack-${deploymentBranch}`, {
    stackName: `${appConfig.name}-sandbox-pipeline-stack-${deploymentBranch}`,
    appConfig: appConfig,
    sandboxPipeline: true,
    env: { account: sandboxPipeline.account, region: sandboxPipeline.region },
  });
}


