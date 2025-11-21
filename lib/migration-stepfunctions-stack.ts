import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { AppConfig } from './config/app-config';
import { MigrationConfig, getAllRanks, getGlueScriptsForRank } from './config/migration-config';
import { MigrationGlueStack } from './migration-glue-stack';
import { MigrationAppFlowStack } from './migration-appflow-stack';

export interface MigrationStepFunctionsStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  migrationConfig: MigrationConfig;
  environment: string;
  glueStack: MigrationGlueStack;
  appFlowStack: MigrationAppFlowStack;
}

/**
 * Migration Step Functions Stack
 * Creates Step Functions state machine to orchestrate migration jobs
 *
 * Execution Flow for Each Rank:
 * 1. Run AppFlow flows to extract Salesforce data to S3 (parallel)
 * 2. Wait for all AppFlow flows to complete
 * 3. Run Glue jobs to transform S3 data to Zeus DB (parallel)
 * 4. Move to next rank
 *
 * Ranks execute sequentially: 200 → 300 → 400 → ... → 2900
 */
export class MigrationStepFunctionsStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  private readonly failureTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MigrationStepFunctionsStackProps) {
    super(scope, id, props);

    const { appConfig, migrationConfig, environment, glueStack, appFlowStack } = props;
    const stackName = `${appConfig.name}-migration-stepfunctions-${environment}`;

    // Create SNS topic for failure notifications
    this.failureTopic = new sns.Topic(this, 'MigrationFailureTopic', {
      topicName: `${stackName}-failures`,
      displayName: 'Migration Job Failures',
    });

    // Create state machine definition
    const definition = this.createStateMachineDefinition(
      appConfig,
      glueStack,
      appFlowStack,
      migrationConfig,
      environment
    );

    // CloudWatch Log Group for state machine
    const logGroup = new logs.LogGroup(this, 'StateMachineLogGroup', {
      logGroupName: `/aws/vendedlogs/states/${stackName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create state machine
    this.stateMachine = new sfn.StateMachine(this, 'MigrationOrchestrator', {
      stateMachineName: `odin-to-zeus-migration-${environment}`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(migrationConfig.stepFunctions.timeoutHours),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });

    // Grant permissions
    this.grantPermissions(glueStack, appFlowStack);

    // Outputs
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      exportName: `${stackName}-state-machine-arn`,
    });

    new cdk.CfnOutput(this, 'FailureTopicArn', {
      value: this.failureTopic.topicArn,
      exportName: `${stackName}-failure-topic-arn`,
    });
  }

  private grantPermissions(glueStack: MigrationGlueStack, appFlowStack: MigrationAppFlowStack): void {
    // Grant permission to start Glue jobs
    for (const [entityName, glueJob] of glueStack.glueJobs.entries()) {
      const glueJobArn = cdk.Stack.of(this).formatArn({
        service: 'glue',
        resource: 'job',
        resourceName: glueJob.ref,
      });

      this.stateMachine.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'glue:StartJobRun',
          'glue:GetJobRun',
          'glue:GetJobRuns',
          'glue:BatchStopJobRun',
        ],
        resources: [glueJobArn],
      }));
    }

    // Grant permission to start AppFlow flows
    for (const [flowId, flow] of appFlowStack.flows.entries()) {
      const flowArn = cdk.Stack.of(this).formatArn({
        service: 'appflow',
        resource: 'flow',
        resourceName: flow.flowName!,
      });

      this.stateMachine.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'appflow:StartFlow',
          'appflow:DescribeFlowExecutionRecords',
        ],
        resources: [flowArn],
      }));
    }

    // Grant permission to publish to SNS
    this.failureTopic.grantPublish(this.stateMachine);
  }

  private createStateMachineDefinition(
    appConfig: AppConfig,
    glueStack: MigrationGlueStack,
    appFlowStack: MigrationAppFlowStack,
    migrationConfig: MigrationConfig,
    environment: string
  ): sfn.IChainable {
    // Initialize migration state
    const initializeMigration = new sfnTasks.CallAwsService(this, 'InitializeMigration', {
      service: 'dynamodb',
      action: 'putItem',
      parameters: {
        TableName: `migration-status-${environment}`,
        Item: {
          'tenant_id': { 'S.$': '$.tenantId' },
          'migration_id': { 'S.$': '$.migrationId' },
          'status': { 'S': 'IN_PROGRESS' },
          'started_at': { 'S.$': '$$.State.EnteredTime' },
        },
      },
      iamAction: 'dynamodb:PutItem',
      iamResources: ['*'],
      resultPath: '$.initResult',
    });

    // Get all ranks from migration config
    const ranks = getAllRanks();
    const rankStates: sfn.IChainable[] = [];

    // Build state machine for each rank
    for (const rank of ranks) {
      const rankConfig = migrationConfig.rankOrderExecution.find(r => r.rank === rank);
      if (!rankConfig || rankConfig.glueScripts.length === 0) {
        continue;
      }

      // Create states for this rank: AppFlow → Glue
      const rankChain = this.createRankExecution(
        rank,
        rankConfig,
        appConfig,
        glueStack,
        appFlowStack,
        migrationConfig
      );

      rankStates.push(rankChain);
    }

    // Complete migration state
    const completeMigration = new sfnTasks.CallAwsService(this, 'CompleteMigration', {
      service: 'dynamodb',
      action: 'updateItem',
      parameters: {
        TableName: `migration-status-${environment}`,
        Key: {
          'tenant_id': { 'S.$': '$.tenantId' },
          'migration_id': { 'S.$': '$.migrationId' },
        },
        UpdateExpression: 'SET #status = :status, #completed_at = :completed_at',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#completed_at': 'completed_at',
        },
        ExpressionAttributeValues: {
          ':status': { 'S': 'COMPLETED' },
          ':completed_at': { 'S.$': '$$.State.EnteredTime' },
        },
      },
      iamAction: 'dynamodb:UpdateItem',
      iamResources: ['*'],
      resultPath: '$.completeResult',
    });

    // Chain all states together: Init → Rank200 → Rank300 → ... → Complete
    let chain: sfn.Chain = sfn.Chain.start(initializeMigration);
    for (const rankState of rankStates) {
      chain = chain.next(rankState);
    }
    chain = chain.next(completeMigration);

    return chain;
  }

  /**
   * Create execution chain for a single rank:
   * 1. Run AppFlow flows in parallel for all source objects in this rank
   * 2. Wait for AppFlow completion
   * 3. Run Glue transformation jobs in parallel
   */
  private createRankExecution(
    rank: number,
    rankConfig: any,
    appConfig: AppConfig,
    glueStack: MigrationGlueStack,
    appFlowStack: MigrationAppFlowStack,
    migrationConfig: MigrationConfig
  ): sfn.IChainable {
    // Step 1: Start AppFlow flows for all source objects in this rank
    const appFlowBranches: sfn.IChainable[] = [];
    const sourceObjects = new Set<string>();

    // Collect all unique source objects for this rank
    for (const script of rankConfig.glueScripts) {
      for (const sourceObject of script.sourceObjects) {
        sourceObjects.add(sourceObject);
      }
    }

    // Create AppFlow execution branches for each source object
    for (const sourceObject of sourceObjects) {
      // Find the AppFlow flow for this object
      const flowKey = Array.from(appFlowStack.flows.keys()).find(key => key.includes(sourceObject));
      if (!flowKey) {
        console.warn(`No AppFlow flow found for object: ${sourceObject} in rank ${rank}`);
        continue;
      }

      const flow = appFlowStack.flows.get(flowKey)!;
      const flowArn = cdk.Stack.of(this).formatArn({
        service: 'appflow',
        resource: 'flow',
        resourceName: flow.flowName!,
      });

      const startFlow = new sfnTasks.CallAwsService(this, `StartFlow-${rank}-${sourceObject}`, {
        service: 'appflow',
        action: 'startFlow',
        parameters: {
          FlowName: flow.flowName,
        },
        iamAction: 'appflow:StartFlow',
        iamResources: [flowArn],
        resultPath: `$.appflow.${sourceObject}`,
      });

      // Add retry for AppFlow
      startFlow.addRetry({
        errors: ['AppFlowException', 'States.TaskFailed'],
        interval: cdk.Duration.seconds(30),
        maxAttempts: 2,
        backoffRate: 2,
      });

      // Add error handling
      const notifyAppFlowFailure = new sfnTasks.SnsPublish(this, `NotifyAppFlowFailure-${rank}-${sourceObject}`, {
        topic: this.failureTopic,
        message: sfn.TaskInput.fromObject({
          rank,
          sourceObject,
          error: sfn.JsonPath.stringAt('$.error'),
          message: `AppFlow extraction failed for ${sourceObject} in rank ${rank}`,
        }),
        subject: `Migration AppFlow Failure: Rank ${rank} - ${sourceObject}`,
      });

      startFlow.addCatch(notifyAppFlowFailure, {
        errors: ['States.ALL'],
        resultPath: '$.error',
      });

      appFlowBranches.push(startFlow);
    }

    // Step 2: Run AppFlow flows in parallel (if any exist)
    let appFlowParallel: sfn.Parallel | null = null;
    if (appFlowBranches.length > 0) {
      appFlowParallel = new sfn.Parallel(this, `AppFlowExtraction-Rank${rank}`, {
        comment: `Extract Salesforce data for rank ${rank} objects`,
      });

      appFlowBranches.forEach(branch => appFlowParallel!.branch(branch));
    }

    // Step 3: Run Glue transformation jobs in parallel
    const glueBranches: sfn.IChainable[] = [];

    for (const scriptConfig of rankConfig.glueScripts) {
      const glueJob = glueStack.glueJobs.get(scriptConfig.entityName);
      if (!glueJob) {
        console.warn(`Glue job not found for entity: ${scriptConfig.entityName}`);
        continue;
      }

      const glueJobArn = cdk.Stack.of(this).formatArn({
        service: 'glue',
        resource: 'job',
        resourceName: glueJob.ref,
      });

      const startGlueJob = new sfnTasks.CallAwsService(this, `StartGlue-${rank}-${scriptConfig.entityName}`, {
        service: 'glue',
        action: 'startJobRun',
        parameters: {
          JobName: glueJob.ref,
          Arguments: {
            '--TENANT_ID.$': '$.tenantId',
            '--ENTITY_NAME': scriptConfig.entityName,
            '--TARGET_SCHEMA': scriptConfig.targetSchema,
            '--TARGET_TABLE': scriptConfig.targetTable,
          },
        },
        iamAction: 'glue:StartJobRun',
        iamResources: [glueJobArn],
        resultPath: `$.glue.${scriptConfig.entityName}`,
      });

      // Add retry for Glue jobs
      startGlueJob.addRetry({
        errors: ['Glue.ConcurrentRunsExceededException', 'States.TaskFailed'],
        interval: cdk.Duration.seconds(migrationConfig.stepFunctions.retry.intervalSeconds),
        maxAttempts: migrationConfig.stepFunctions.retry.maxAttempts,
        backoffRate: migrationConfig.stepFunctions.retry.backoffRate,
      });

      // Add error handling
      const notifyGlueFailure = new sfnTasks.SnsPublish(this, `NotifyGlueFailure-${rank}-${scriptConfig.entityName}`, {
        topic: this.failureTopic,
        message: sfn.TaskInput.fromObject({
          rank,
          entity: scriptConfig.entityName,
          error: sfn.JsonPath.stringAt('$.error'),
          message: `Glue transformation failed for ${scriptConfig.entityName} in rank ${rank}`,
        }),
        subject: `Migration Glue Failure: Rank ${rank} - ${scriptConfig.entityName}`,
      });

      startGlueJob.addCatch(notifyGlueFailure, {
        errors: ['States.ALL'],
        resultPath: '$.error',
      });

      glueBranches.push(startGlueJob);
    }

    const glueParallel = new sfn.Parallel(this, `GlueTransformation-Rank${rank}`, {
      comment: `Transform and load data for rank ${rank}`,
    });

    glueBranches.forEach(branch => glueParallel.branch(branch));

    // Chain: AppFlow (if exists) → Glue
    if (appFlowParallel) {
      return appFlowParallel.next(glueParallel);
    } else {
      return glueParallel;
    }
  }
}

