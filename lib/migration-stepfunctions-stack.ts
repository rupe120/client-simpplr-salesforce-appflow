import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { AppConfig } from './config/app-config';
import { MigrationConfig } from './config/migration-config';
import { MigrationGlueStack } from './migration-glue-stack';

export interface MigrationStepFunctionsStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  migrationConfig: MigrationConfig;
  environment: string;
  glueStack: MigrationGlueStack;
}

/**
 * Migration Step Functions Stack
 * Creates Step Functions state machine to orchestrate migration jobs
 * Executes Glue jobs in parallel within ranks, sequentially across ranks
 */
export class MigrationStepFunctionsStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: MigrationStepFunctionsStackProps) {
    super(scope, id, props);

    const { appConfig, migrationConfig, environment, glueStack } = props;
    const stackName = `${appConfig.name}-migration-stepfunctions-${environment}`;

    // Create state machine definition
    const definition = this.createStateMachineDefinition(glueStack, migrationConfig, environment);

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

    // Grant state machine permission to start Glue jobs
    for (const [entityName, glueJob] of glueStack.glueJobs.entries()) {
      // Construct Glue job ARN manually
      const glueJobArn = cdk.Stack.of(this).formatArn({
        service: 'glue',
        resource: 'job',
        resourceName: glueJob.ref,
      });
      
      this.stateMachine.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'glue:StartJobRun',
          'glue:GetJobRun',
          'glue:BatchStopJobRun',
        ],
        resources: [glueJobArn],
      }));
    }

    // Outputs
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      exportName: `${stackName}-state-machine-arn`,
    });
  }

  private createStateMachineDefinition(
    glueStack: MigrationGlueStack,
    migrationConfig: MigrationConfig,
    environment: string
  ): sfn.IChainable {
    // Initialize migration state
    const initializeMigration = new sfnTasks.CallAwsService(this, 'InitializeMigration', {
      service: 'glue',
      action: 'startJobRun',
      parameters: {
        JobName: `migration-init-${environment}`,
        Arguments: {
          '--orgId.$': '$.orgId',
          '--environment.$': '$.environment',
        },
      },
      iamAction: 'glue:StartJobRun',
      iamResources: ['*'],
      resultPath: '$.initResult',
    });

    // Create parallel branches for each rank
    // In practice, load ranks from migration_jobs.json
    const ranks = this.getRanks(migrationConfig);
    const rankStates: sfn.IChainable[] = [];

    for (let i = 0; i < ranks.length; i++) {
      const rank = ranks[i];
      const entities = this.getEntitiesForRank(rank, migrationConfig);
      
      // Skip ranks with no entities (Parallel state requires at least one branch)
      if (entities.length === 0) {
        continue;
      }

      // Create parallel branches for entities in this rank
      const entityBranches = entities.map(entityName => {
        const glueJob = glueStack.glueJobs.get(entityName);
        if (!glueJob) {
          throw new Error(`Glue job not found for entity: ${entityName}`);
        }

        // Construct Glue job ARN manually
        const glueJobArn = cdk.Stack.of(this).formatArn({
          service: 'glue',
          resource: 'job',
          resourceName: glueJob.ref,
        });

        const runEntity = new sfnTasks.CallAwsService(this, `RunEntity-${entityName}`, {
          service: 'glue',
          action: 'startJobRun',
          parameters: {
            JobName: glueJob.name,
            Arguments: {
              '--orgId.$': '$.orgId',
              '--entityName': entityName,
            },
          },
          iamAction: 'glue:StartJobRun',
          iamResources: [glueJobArn],
          resultPath: `$.${entityName}Result`,
        });

        const errorHandler = new sfnTasks.SnsPublish(this, `NotifyFailure-${entityName}`, {
          topic: new sns.Topic(this, `FailureTopic-${entityName}`),
          message: sfn.TaskInput.fromText(`Glue Job Failed: ${entityName}`),
          subject: `Migration Failure: ${entityName}`,
        });

        return runEntity.addCatch(errorHandler, {
          errors: ['States.ALL'],
          resultPath: '$.error',
        });
      });

      const executeRank = new sfn.Parallel(this, `ExecuteRank${rank}`, {
        comment: `Execute rank ${rank} entities in parallel`,
      });

      entityBranches.forEach(branch => executeRank.branch(branch));

      // Add retry logic
      executeRank.addRetry({
        errors: ['States.TaskFailed', 'Glue.ConcurrentRunsExceededException'],
        interval: cdk.Duration.seconds(migrationConfig.stepFunctions.retry.intervalSeconds),
        maxAttempts: migrationConfig.stepFunctions.retry.maxAttempts,
        backoffRate: migrationConfig.stepFunctions.retry.backoffRate,
      });

      rankStates.push(executeRank);
    }

    // Complete migration state
    const completeMigration = new sfnTasks.CallAwsService(this, 'CompleteMigration', {
      service: 'glue',
      action: 'startJobRun',
      parameters: {
        JobName: `migration-complete-${environment}`,
        Arguments: {
          '--orgId.$': '$.orgId',
          '--status': 'SUCCESS',
        },
      },
      iamAction: 'glue:StartJobRun',
      iamResources: ['*'],
      resultPath: '$.completeResult',
    });

    // Chain all states together
    let chain: sfn.Chain = sfn.Chain.start(initializeMigration);
    for (const rankState of rankStates) {
      chain = chain.next(rankState);
    }
    chain = chain.next(completeMigration);

    return chain;
  }

  private getRanks(migrationConfig: MigrationConfig): string[] {
    // In practice, load from migration_jobs.json
    // For now, return sample ranks
    return ['100', '200', '300', '400', '500', '600'];
  }

  private getEntitiesForRank(rank: string, migrationConfig: MigrationConfig): string[] {
    // In practice, load from migration_jobs.json
    // For now, return sample entities
    if (rank === '100') {
      return ['ps-pre-migration-steps', 'ps-cust-org-info'];
    } else if (rank === '200') {
      return ['identity-users', 'identity-profiles', 'identity-followers'];
    } else if (rank === '300') {
      return ['cont-sites', 'cont-pages', 'cont-content'];
    }
    return [];
  }
}

