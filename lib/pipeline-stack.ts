import * as cdk from 'aws-cdk-lib';
import * as pipelines from 'aws-cdk-lib/pipelines';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Construct } from 'constructs';
import { PipelineAppStage } from './pipeline-app-stage';
import { AppConfig } from './config/app-config';

export interface  PipelineStackProps extends cdk.StackProps {
  appConfig: AppConfig;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);


    // Create the pipeline
    const repoString = `${props.appConfig.pipeline.repositoryOwner}/${props.appConfig.pipeline.repositoryName}`;
    const codeInput = pipelines.CodePipelineSource.connection(repoString, props.appConfig.pipeline.branch,
      {
        connectionArn: props.appConfig.pipeline.connectionArn,
      }
    );
    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: `${props.appConfig.name}-pipeline`,
      crossAccountKeys: true,
      synth: new pipelines.ShellStep('Synth', {
        input: codeInput, // Replace with your GitHub repo
        commands: [
          'npm ci',
          'npm run build',
          'npx cdk synth'
        ]
      }),
    });

    // Add the application stage
    for (const environment of props.appConfig.environments) {
      const pipelineStage = new PipelineAppStage(this, 'AppStage', {
        appConfig: props.appConfig,
        envConfig: environment,
        env: {
          account: environment.account,
          region: environment.region,
        },
      });
      const stage = pipeline.addStage(pipelineStage);
      if (environment.requiresApproval) {
        stage.addPre(new pipelines.ManualApprovalStep(`${environment.name}-approval`,
          {
            comment: `Please approve the deployment to ${environment.name}`,
          }
        ));
      }

      // // Add frontend build step after the application deployment
      // stage.addPost(new pipelines.CodeBuildStep(`${environment.name}-frontend-build`, {
      //   input: codeInput, 
      //   commands: [
      //     'cd src-frontend',
      //     'npm ci',
      //     'npm run build',
      //     'aws s3 sync build/ s3://${S3_HOSTING_BUCKET} --delete'
      //   ],
      //   buildEnvironment: {
      //     buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      //     computeType: codebuild.ComputeType.SMALL,
      //   },
      //   env: {
      //     S3_HOSTING_BUCKET: `${props.appConfig.name}-s3-hosting-bucket-${environment.name}`,
      //   },
      //   rolePolicyStatements: [
      //     new cdk.aws_iam.PolicyStatement({
      //       effect: cdk.aws_iam.Effect.ALLOW,
      //       actions: [
      //         's3:GetObject',
      //         's3:PutObject',
      //         's3:DeleteObject',
      //         's3:ListBucket',
      //       ],
      //       resources: [
      //         `arn:aws:s3:::${props.appConfig.name}-s3-hosting-bucket-${environment.name}`,
      //         `arn:aws:s3:::${props.appConfig.name}-s3-hosting-bucket-${environment.name}/*`,
      //       ],
      //     }),
      //   ],
      // }));
    }

  }
  
}
