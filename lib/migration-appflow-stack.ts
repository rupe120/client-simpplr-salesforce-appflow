import * as cdk from 'aws-cdk-lib';
import * as appflow from 'aws-cdk-lib/aws-appflow';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AppConfig, EnvironmentConfig } from './config/app-config';
import { MigrationStorageStack } from './migration-storage-stack';

export interface MigrationAppFlowStackProps extends cdk.StackProps {
  appConfig: AppConfig;
  envConfig: EnvironmentConfig;
  storageStack: MigrationStorageStack;
}

/**
 * Migration AppFlow Stack
 * Creates AppFlow flows for each customer and Salesforce object
 * Extracts data from Salesforce and stores in S3
 */
export class MigrationAppFlowStack extends cdk.Stack {
  public readonly flows: Map<string, appflow.CfnFlow> = new Map();

  constructor(scope: Construct, id: string, props: MigrationAppFlowStackProps) {
    super(scope, id, props);

    const { appConfig, envConfig, storageStack } = props;
    const environment = envConfig.name;
    const stackName = `${appConfig.name}-migration-appflow-${environment}`;


    const salesforceConnectorSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'SalesforceConnectorSecret', envConfig.salesforce.connectionArn);
    salesforceConnectorSecret.grantRead(new iam.ServicePrincipal('appflow.amazonaws.com'));
    
    // Create AppFlow connection profile for Salesforce
    const connectionProfile = new appflow.CfnConnectorProfile(this, 'SalesforceConnectionProfile', {
      connectorProfileName: `${appConfig.name}-salesforce-connection-profile-${environment}`,
      connectorType: 'Salesforce',
      connectionMode: 'Public',
      connectorProfileConfig: {
        connectorProfileProperties: {
          salesforce: {
            instanceUrl: envConfig.salesforce.instanceUrl,
            isSandboxEnvironment: false,
          },
        },
        connectorProfileCredentials: {
          salesforce: {
            clientCredentialsArn: envConfig.salesforce.connectionArn,
          }
        }
      },
    });

    // Create flows for each customer
    for (const customer of appConfig.customers) {
      // Get Salesforce objects from customer config or use default migration objects
      const salesforceObjects = appConfig.appFlowConfig.objectsToTransfer.map((objectToTransfer) => objectToTransfer.sourceObject);

      // Create a flow for each Salesforce object
      for (const sfObject of salesforceObjects) {
        const flowId = `${appConfig.name}-${customer.customerId}-${sfObject}-${environment}`;
        const flowName = `migration-${flowId}-${environment}`.toLowerCase();

        const flow = new appflow.CfnFlow(this, `Flow-${flowId}`, {
          flowName: flowName,
          description: `Migration flow for ${customer.name} - ${sfObject}`,
          triggerConfig: {
            triggerType: 'OnDemand', // Triggered by Step Functions
          },
          
          sourceFlowConfig: {
            connectorType: 'Salesforce',
            sourceConnectorProperties: {
              salesforce: {
                object: sfObject,
                enableDynamicFieldUpdate: true,
                includeDeletedRecords: false,
              },
            },
            connectorProfileName: connectionProfile.connectorProfileName!,
          },
          destinationFlowConfigList: [{
            connectorType: 'S3',
            destinationConnectorProperties: {
              s3: {
                bucketName: storageStack.rawDataBucket.bucketName,
                s3OutputFormatConfig: {
                  fileType: 'JSON', // Can be changed to Parquet for better performance
                  prefixConfig: {
                    prefixType: 'PATH',
                    prefixFormat: 'DAY',
                  },
                  aggregationConfig: {
                    aggregationType: 'None',
                  },
                },
              },
            },
          }],
          tasks: [
            {
              taskType: 'Map',
              sourceFields: ['*'], // Map all fields
              destinationField: '',
              taskProperties: [],
            },
          ],
        });

        flow.addDependency(connectionProfile);
        this.flows.set(flowId, flow);

        // Grant AppFlow permission to write to S3
        storageStack.rawDataBucket.grantWrite(
          new iam.ServicePrincipal('appflow.amazonaws.com')
        );
      }
    }

    // Outputs
    new cdk.CfnOutput(this, 'ConnectionProfileName', {
      value: connectionProfile.connectorProfileName!,
      exportName: `${stackName}-connection-profile`,
    });
  }
}

