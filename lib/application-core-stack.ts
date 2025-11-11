import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import * as ecs from 'aws-cdk-lib/aws-ecs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface ApplicationCoreStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
}

export class ApplicationCoreStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly ecsCluster: ecs.Cluster;
  
  constructor(scope: Construct, id: string, props: ApplicationCoreStackProps) {
    super(scope, id, props);
    // Create VPC with 3 availability zones
    const vpc = new ec2.Vpc(this, 'MainVpc', {
      vpcName: `${props.appConfig.name}-vpc-${props.envConfig.name}`,
      ipAddresses: ec2.IpAddresses.cidr(props.envConfig.vpc.cidr),
      maxAzs: props.envConfig.vpc.maxAzs,
      natGateways: props.envConfig.vpc.natGateways, 
      subnetConfiguration: [
        {
          cidrMask: props.envConfig.vpc.subnets.publicCidrMask,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: props.envConfig.vpc.subnets.privateCidrMask,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: props.envConfig.vpc.subnets.protectedCidrMask,
          name: 'Protected',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Store VPC information for export
    this.vpc = vpc;

    // Create ECS cluster
    this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: `${props.appConfig.name}-ecs-cluster-${props.envConfig.name}`,
      vpc: this.vpc,
    });

  }
}
