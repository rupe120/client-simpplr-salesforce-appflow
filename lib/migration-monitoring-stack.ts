import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { AppConfig } from './config/app-config';
import { MigrationStepFunctionsStack } from './migration-stepfunctions-stack';
import { MigrationGlueStack } from './migration-glue-stack';

export interface MigrationMonitoringStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  environment: string;
  stepFunctionsStack: MigrationStepFunctionsStack;
  glueStack: MigrationGlueStack;
  notificationEmail?: string;
}

/**
 * Migration Monitoring Stack
 * Creates CloudWatch dashboards and SNS topics for monitoring and notifications
 */
export class MigrationMonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly failureTopic: sns.Topic;
  public readonly successTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MigrationMonitoringStackProps) {
    super(scope, id, props);

    const { appConfig, environment, stepFunctionsStack, glueStack, notificationEmail } = props;
    const stackName = `${appConfig.name}-migration-monitoring-${environment}`;

    // SNS Topics for notifications
    this.failureTopic = new sns.Topic(this, 'FailureTopic', {
      topicName: `${stackName}-failures`,
      displayName: 'Migration Failure Notifications',
    });

    this.successTopic = new sns.Topic(this, 'SuccessTopic', {
      topicName: `${stackName}-success`,
      displayName: 'Migration Success Notifications',
    });

    // Add email subscription if provided
    if (notificationEmail) {
      this.failureTopic.addSubscription(
        new subscriptions.EmailSubscription(notificationEmail)
      );
      this.successTopic.addSubscription(
        new subscriptions.EmailSubscription(notificationEmail)
      );
    }

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'MigrationDashboard', {
      dashboardName: `migration-monitoring-${environment}`,
    });

    // Step Functions Metrics
    const stepFunctionsWidget = new cloudwatch.GraphWidget({
      title: 'Step Functions Executions',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/States',
          metricName: 'ExecutionsSucceeded',
          statistic: 'Sum',
          dimensionsMap: {
            StateMachineArn: stepFunctionsStack.stateMachine.stateMachineArn,
          },
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/States',
          metricName: 'ExecutionsFailed',
          statistic: 'Sum',
          dimensionsMap: {
            StateMachineArn: stepFunctionsStack.stateMachine.stateMachineArn,
          },
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/States',
          metricName: 'ExecutionsStarted',
          statistic: 'Sum',
          dimensionsMap: {
            StateMachineArn: stepFunctionsStack.stateMachine.stateMachineArn,
          },
        }),
      ],
      width: 12,
      height: 6,
    });

    // Glue Job Metrics
    const glueMetrics: cloudwatch.Metric[] = [];
    for (const [entityName, glueJob] of glueStack.glueJobs.entries()) {
      glueMetrics.push(
        new cloudwatch.Metric({
          namespace: 'AWS/Glue',
          metricName: 'glue.driver.aggregate.numFailedTasks',
          statistic: 'Sum',
          dimensionsMap: {
            JobName: glueJob.name!,
          },
          label: entityName,
        })
      );
    }

    const glueWidget = new cloudwatch.GraphWidget({
      title: 'Glue Job Failures',
      left: glueMetrics,
      width: 12,
      height: 6,
    });

    // Glue DPU Utilization
    const dpuMetrics: cloudwatch.Metric[] = [];
    for (const [entityName, glueJob] of glueStack.glueJobs.entries()) {
      dpuMetrics.push(
        new cloudwatch.Metric({
          namespace: 'AWS/Glue',
          metricName: 'glue.ALL.dpuUtilization',
          statistic: 'Average',
          dimensionsMap: {
            JobName: glueJob.name!,
          },
          label: entityName,
        })
      );
    }

    const dpuWidget = new cloudwatch.GraphWidget({
      title: 'Glue DPU Utilization',
      left: dpuMetrics,
      width: 12,
      height: 6,
    });

    // Add widgets to dashboard
    this.dashboard.addWidgets(stepFunctionsWidget, glueWidget, dpuWidget);

    // CloudWatch Alarms
    // Step Functions failure alarm
    const stepFunctionsFailureAlarm = new cloudwatch.Alarm(this, 'StepFunctionsFailureAlarm', {
      alarmName: `${stackName}-stepfunctions-failures`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/States',
        metricName: 'ExecutionsFailed',
        statistic: 'Sum',
        dimensionsMap: {
          StateMachineArn: stepFunctionsStack.stateMachine.stateMachineArn,
        },
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    stepFunctionsFailureAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.failureTopic)
    );

    // Glue job failure alarm (aggregate)
    const glueFailureAlarm = new cloudwatch.Alarm(this, 'GlueFailureAlarm', {
      alarmName: `${stackName}-glue-failures`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Glue',
        metricName: 'glue.driver.aggregate.numFailedTasks',
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    glueFailureAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.failureTopic)
    );

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'FailureTopicArn', {
      value: this.failureTopic.topicArn,
      exportName: `${stackName}-failure-topic-arn`,
    });
  }
}

