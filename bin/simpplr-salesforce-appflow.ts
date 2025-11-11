#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { appConfig } from '../lib/config/app-config';

const app = new cdk.App();


// Deploy the pipeline stack
new PipelineStack(app, 'SimpplrSalesforceAppflowPipelineStack', {
  stackName: `${appConfig.name}-pipeline-stack`,
  appConfig: appConfig,
  env: { account: appConfig.pipeline.account, region: appConfig.pipeline.region },
});
