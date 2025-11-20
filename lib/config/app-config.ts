export const appConfig: AppConfig = {
  name: 'simpplr-salesforce-appflow',
  version: '0.1.0',

  pipeline: {
    account: '533101977259',
    region: 'us-east-1',
    repositoryName: 'client-simpplr-salesforce-appflow',
    repositoryOwner: 'rupe120',
    branch: 'main',
    connectionArn: 'arn:aws:codeconnections:us-east-1:533101977259:connection/f6c95e2e-b84b-4b47-be67-f8a514d794ed',
  },

  salesforce: {
    // Salesforce connection configuration
    // This will be used to create AppFlow connections
    connectionProfileName: 'simpplr-salesforce-connection',
    instanceUrl: 'https://simpplr.my.salesforce.com', // Update with actual Salesforce instance URL
  },

  customers: [
    {
      customerId: 'customer-001',
      name: 'Example Customer 1',
      salesforceOrgId: 'SALESFORCE_ORG_ID_1', // Unique Salesforce Org ID for this customer
      rdsConfig: {
        host: 'simpplrtemptargetstack-postgresdatabase0a8a7373-3j7r0morhnlq.cmhxw6zfvtzj.us-east-1.rds.amazonaws.com',
        port: 5432,
        database: 'simpplrdb',
        secretArn: 'arn:aws:secretsmanager:us-east-1:533101977259:secret:PostgresDatabaseSecret8058A-wDFf66VGvVsQ-t4BSD6',
        engine: 'postgres',
      },
      appFlowConfig: {
        // Salesforce objects to sync
        objects: ['Account', 'Contact', 'Opportunity', 'CustomObject__c'],
        // Flow execution schedule (cron expression)
        scheduleExpression: 'rate(1 hour)',
        // Transformation rules per object
        transformations: [
          {
            sourceObject: 'Account',
            destinationTable: 'accounts',
            fieldMappings: [
              { source: 'Id', destination: 'salesforce_id', transform: 'NONE' },
              { source: 'Name', destination: 'account_name', transform: 'NONE' },
              { source: 'Industry', destination: 'industry', transform: 'NONE' },
            ],
            // Generate multiple records based on related data
            multiRecordStrategy: 'NONE', // Options: 'NONE', 'SPLIT_BY_FIELD', 'CUSTOM_LAMBDA'
          },
          {
            sourceObject: 'Contact',
            destinationTable: 'contacts',
            fieldMappings: [
              { source: 'Id', destination: 'salesforce_id', transform: 'NONE' },
              { source: 'FirstName', destination: 'first_name', transform: 'NONE' },
              { source: 'LastName', destination: 'last_name', transform: 'NONE' },
              { source: 'Email', destination: 'email', transform: 'MASK_EMAIL' },
            ],
            multiRecordStrategy: 'NONE',
          },
        ],
      },
    },
    // Add more customers as needed
    // {
    //   customerId: 'customer-002',
    //   name: 'Example Customer 2',
    //   salesforceOrgId: 'SALESFORCE_ORG_ID_2',
    //   rdsConfig: { ... },
    //   appFlowConfig: { ... },
    // },
  ],

  environments: [
    {
      name: 'dev',
      account: '533101977259',
      region: 'us-east-1',
      requiresApproval: false,
      // Reference to existing VPC that contains the RDS instances
      vpcId: 'vpc-0945a7bbfa144b582' // Update with actual VPC ID where RDS instances are located
    }
  ]
};

export class AppConfig {
    public name: string;
    public version: string;
    public pipeline: {
        account: string;
        region: string;
        repositoryName: string;
        repositoryOwner: string;
        branch: string;
        connectionArn: string;
    };
    public salesforce: {
        connectionProfileName: string;
        instanceUrl: string;
    };
    public customers: CustomerConfig[];
    public environments: EnvironmentConfig[] = [];
}

export class EnvironmentConfig {
    public name: string;
    public account: string;
    public region: string;
    public requiresApproval: boolean;
    public vpcId: string; // ID of existing VPC that contains RDS instances
}

export interface CustomerConfig {
    customerId: string;
    name: string;
    salesforceOrgId: string;
    rdsConfig: RDSConfig;
    appFlowConfig: AppFlowConfig;
}

export interface RDSConfig {
    host: string;
    port: number;
    database: string;
    secretArn: string;
    engine: 'postgres' | 'mysql' | 'mariadb' | 'oracle' | 'sqlserver';
}

export interface AppFlowConfig {
    objects: string[];
    scheduleExpression: string;
    transformations: TransformationConfig[];
}

export interface TransformationConfig {
    sourceObject: string;
    destinationTable: string;
    fieldMappings: FieldMapping[];
    multiRecordStrategy: 'NONE' | 'SPLIT_BY_FIELD' | 'CUSTOM_LAMBDA';
    customLambdaArn?: string; // Required if multiRecordStrategy is CUSTOM_LAMBDA
    splitFieldName?: string; // Required if multiRecordStrategy is SPLIT_BY_FIELD
}

export interface FieldMapping {
    source: string;
    destination: string;
    transform: TransformType;
}

export type TransformType =
    | 'NONE'
    | 'MASK_EMAIL'
    | 'MASK_PHONE'
    | 'TRUNCATE'
    | 'UPPER_CASE'
    | 'LOWER_CASE'
    | 'CONCATENATE'
    | 'SPLIT'
    | 'CUSTOM';