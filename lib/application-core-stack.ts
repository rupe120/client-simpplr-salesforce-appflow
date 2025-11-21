import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import * as ecs from 'aws-cdk-lib/aws-ecs';

export interface ApplicationCoreStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
}

export class ApplicationCoreStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: ApplicationCoreStackProps) {
    super(scope, id, props);

    // Lookup existing VPC by ID
    // This VPC should contain the external RDS instances
    const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
      vpcId: props.envConfig.vpcId,
    });

    // Store VPC information for export
    this.vpc = vpc;


    const salesforceConnectorSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'SalesforceConnectorSecret', envConfig.salesforce.connectionArn);
    salesforceConnectorSecret.grantRead(new iam.ServicePrincipal('appflow.amazonaws.com'));


    // Output VPC information for reference
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID where resources are deployed',
      exportName: `${props.appConfig.name}-vpc-id-${props.envConfig.name}`,
    });

    new cdk.CfnOutput(this, 'VpcPrivateSubnets', {
      value: vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Private subnet IDs',
      exportName: `${props.appConfig.name}-private-subnets-${props.envConfig.name}`,
    });
  }
}
