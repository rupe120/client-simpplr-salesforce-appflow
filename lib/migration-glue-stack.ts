import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AppConfig } from './config/app-config';
import { MigrationConfig, getAllGlueScripts, GlueScriptConfig } from './config/migration-config';
import { MigrationStorageStack } from './migration-storage-stack';
import { ApplicationCoreStack } from './application-core-stack';

export interface MigrationGlueStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  migrationConfig: MigrationConfig;
  environment: string;
  storageStack: MigrationStorageStack;
  coreStack: ApplicationCoreStack;
  zeusDbSecret: secretsmanager.ISecret;
  cdcDbSecret: secretsmanager.ISecret;
}

/**
 * Migration Glue Stack
 * Creates Glue ETL jobs for each entity type
 * Sets up Glue Data Catalog and VPC connections for database access
 */
export class MigrationGlueStack extends cdk.Stack {
  public readonly glueJobs: Map<string, glue.CfnJob> = new Map();
  public readonly glueServiceRole: iam.Role;
  public readonly glueVpcConnection: glue.CfnConnection;

  constructor(scope: Construct, id: string, props: MigrationGlueStackProps) {
    super(scope, id, props);

    const { appConfig, migrationConfig, environment, storageStack, coreStack, zeusDbSecret, cdcDbSecret } = props;
    const stackName = `${appConfig.name}-migration-glue-${environment}`;

    // Glue Service Role with necessary permissions
    this.glueServiceRole = new iam.Role(this, 'GlueServiceRole', {
      roleName: `${stackName}-glue-role`,
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    // Grant permissions to S3 buckets
    storageStack.rawDataBucket.grantRead(this.glueServiceRole);
    storageStack.processedDataBucket.grantReadWrite(this.glueServiceRole);
    storageStack.errorDataBucket.grantWrite(this.glueServiceRole);
    storageStack.scriptsBucket.grantRead(this.glueServiceRole);
    storageStack.tempBucket.grantReadWrite(this.glueServiceRole);
    storageStack.logsBucket.grantWrite(this.glueServiceRole);

    // Grant permissions to Secrets Manager
    zeusDbSecret.grantRead(this.glueServiceRole);
    cdcDbSecret.grantRead(this.glueServiceRole);

    // Grant permissions to DynamoDB tables
    storageStack.emsTable.grantReadWriteData(this.glueServiceRole);
    storageStack.tmsTable.grantReadWriteData(this.glueServiceRole);

    // Create VPC Connection for Glue to access RDS
    const securityGroup = new ec2.SecurityGroup(this, 'GlueSecurityGroup', {
      vpc: coreStack.vpc,
      description: 'Security group for Glue jobs to access RDS',
      allowAllOutbound: true,
    });

    // Allow Glue to connect to RDS (adjust port as needed)
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(coreStack.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432), // PostgreSQL default port
      'Allow Glue to connect to RDS'
    );

    this.glueVpcConnection = new glue.CfnConnection(this, 'GlueVpcConnection', {
      catalogId: this.account,
      connectionInput: {
        name: `${stackName}-vpc-connection`,
        connectionType: 'NETWORK',
        connectionProperties: {},
        physicalConnectionRequirements: {
          availabilityZone: coreStack.vpc.availabilityZones[0],
          subnetId: coreStack.vpc.privateSubnets[0].subnetId,
          securityGroupIdList: [securityGroup.securityGroupId],
        },
      },
    });

    // Create Glue Data Catalog Database
    const migrationDatabase = new glue.CfnDatabase(this, 'MigrationDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: `migration_catalog_${environment}`,
        description: 'Data catalog for migration ETL jobs',
      },
    });

    // Create Crawler for raw data
    const rawDataCrawler = new glue.CfnCrawler(this, 'RawDataCrawler', {
      name: `${stackName}-raw-data-crawler`,
      role: this.glueServiceRole.roleArn,
      databaseName: migrationDatabase.ref,
      targets: {
        s3Targets: [{
          path: `s3://${storageStack.rawDataBucket.bucketName}/`,
        }],
      },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
    });
    rawDataCrawler.addDependency(migrationDatabase);

    // Create Glue jobs from rankOrderExecution configuration
    const allGlueScripts = getAllGlueScripts();

    for (const scriptConfig of allGlueScripts) {
      const job = this.createEntityGlueJob(
        scriptConfig,
        storageStack,
        zeusDbSecret,
        cdcDbSecret,
        migrationConfig,
        environment
      );
      this.glueJobs.set(scriptConfig.entityName, job);
    }

    // Outputs
    new cdk.CfnOutput(this, 'GlueServiceRoleArn', {
      value: this.glueServiceRole.roleArn,
      exportName: `${stackName}-glue-role-arn`,
    });

    new cdk.CfnOutput(this, 'GlueVpcConnectionName', {
      value: this.glueVpcConnection.ref,
      exportName: `${stackName}-vpc-connection`,
    });
  }

  private createEntityGlueJob(
    scriptConfig: GlueScriptConfig,
    storageStack: MigrationStorageStack,
    zeusDbSecret: secretsmanager.ISecret,
    cdcDbSecret: secretsmanager.ISecret,
    migrationConfig: MigrationConfig,
    environment: string
  ): glue.CfnJob {
    const jobName = `migration-${scriptConfig.entityName}-${environment}`;

    return new glue.CfnJob(this, `GlueJob-${scriptConfig.entityName}`, {
      name: jobName,
      role: this.glueServiceRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: `s3://${storageStack.scriptsBucket.bucketName}/glue-jobs/${scriptConfig.scriptName}/script.py`,
        pythonVersion: migrationConfig.glue.pythonVersion,
      },
      glueVersion: migrationConfig.glue.glueVersion,
      maxCapacity: scriptConfig.dpuAllocation,
      maxRetries: migrationConfig.glue.maxRetries,
      timeout: scriptConfig.timeoutMinutes,
      executionProperty: {
        maxConcurrentRuns: 1, // Prevent duplicate runs
      },
      connections: {
        connections: [this.glueVpcConnection.ref],
      },
      defaultArguments: {
        '--TempDir': `s3://${storageStack.tempBucket.bucketName}/temp/`,
        '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-metrics': 'true',
        '--enable-spark-ui': 'true',
        '--spark-event-logs-path': `s3://${storageStack.logsBucket.bucketName}/spark-logs/`,
        '--enable-glue-datacatalog': 'true',
        '--ENTITY_NAME': scriptConfig.entityName,
        '--TARGET_SCHEMA': scriptConfig.targetSchema,
        '--TARGET_TABLE': scriptConfig.targetTable,
        '--ZEUS_DB_SECRET_ARN': zeusDbSecret.secretArn,
        '--CDC_DB_SECRET_ARN': cdcDbSecret.secretArn,
        '--RAW_DATA_BUCKET': storageStack.rawDataBucket.bucketName,
        '--PROCESSED_DATA_BUCKET': storageStack.processedDataBucket.bucketName,
        '--ERROR_DATA_BUCKET': storageStack.errorDataBucket.bucketName,
        '--EMS_TABLE_NAME': storageStack.emsTable.tableName,
        '--TMS_TABLE_NAME': storageStack.tmsTable.tableName,
        // Spark performance optimizations
        '--conf': [
          'spark.sql.adaptive.enabled=true',
          'spark.sql.adaptive.coalescePartitions.enabled=true',
          'spark.sql.adaptive.skewJoin.enabled=true',
          'spark.serializer=org.apache.spark.serializer.KryoSerializer',
          'spark.sql.parquet.compression.codec=snappy',
        ].join(','),
      },
    });
  }
}

