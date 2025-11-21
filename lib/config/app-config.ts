export const appConfig: AppConfig = {
  name: 'migration-tool',
  version: '0.1.0',

  pipeline: {
    account: '533101977259',
    region: 'us-east-1',
    repositoryName: 'simpplr',
    repositoryOwner: 'muhammad-atout-protagona',
    branch: 'main',
    connectionArn: 'arn:aws:codeconnections:us-east-1:533101977259:connection/65240ae6-4785-4000-9a83-89acc30b3fc0',
  },

  sandboxEnvironments: [
    {
      // JRusso sandbox environment
      pipelineConfig: {
        account: '971764590821',
        region: 'us-east-1',
        repositoryName: 'client-simpplr-salesforce-appflow',
        repositoryOwner: 'rupe120',
        branch: 'sandbox-jrusso',
        connectionArn: 'arn:aws:codeconnections:us-east-1:971764590821:connection/28f626ba-e037-48b7-b835-23050945dbd7'
      },
      environmentConfig: {
        name: 'jrusso',
        account: '971764590821',
        region: 'us-east-1',
        requiresApproval: false,
        salesforce: {
          secretArn: 'arn:aws:secretsmanager:us-east-1:971764590821:secret:appflow!971764590821-sf-temp-1763741024664-KGA0wB',
          instanceUrl: 'https://protagona-sf-demo.my.salesforce.com',
          connectorProfileName: 'sf-temp', // Use existing AppFlow connector profile
        },
        vpcId: 'vpc-09f209142675bf3c6',
        rdsConfig: {
          secretArn: 'arn:aws:secretsmanager:us-east-1:971764590821:secret:PostgresDatabaseSecret8058A-dOuMy2PmAopi-5SD6Ws',
        },
      },
    },
    {
      // MAtout sandbox environment
      pipelineConfig: {
        account: '533101977259',
        region: 'us-east-1',
        repositoryName: 'client-simpplr-salesforce-appflow',
        repositoryOwner: 'muhammad-atout-protagona',
        branch: 'sandbox-matout',
        connectionArn: 'arn:aws:codeconnections:us-east-1:533101977259:connection/65240ae6-4785-4000-9a83-89acc30b3fc0',
      },
      environmentConfig: {
        name: 'matout',
        account: '533101977259',
        region: 'us-east-1',
        requiresApproval: false,
        salesforce: {
          secretArn: 'arn:aws:secretsmanager:us-east-1:533101977259:secret:appflow!533101977259-sf-temp-1763741024664-KGA0wB',
          instanceUrl: 'https://protagona-sf-demo.my.salesforce.com',
        },
        vpcId: 'vpc-0945a7bbfa144b582',
        rdsConfig: {
          secretArn: 'arn:aws:secretsmanager:us-east-1:533101977259:secret:PostgresDatabaseSecret8058A-wDFf66VGvVsQ-t4BSD6',
        },
      },
    }
  ],
  
  appFlowConfig: {
    // Flow execution schedule (cron expression)
    scheduleExpression: 'rate(1 day)',

    // Salesforce objects grouped by execution rank (dependency stages)
    // Ranks execute sequentially (100 → 200 → 300 → ...), objects within same rank can be extracted in parallel
    // Note: Rank 100 contains pre-migration setup entities, but no direct Salesforce object extraction
    salesforceObjectsByRank: {
      // Rank 100: Pre-Migration Initialization
      // No Salesforce objects extracted (setup and validation only)
      100: [],

      // Rank 200: Identity Foundation
      200: [
        { object: 'User', description: 'Standard Salesforce users' },
        { object: 'Profile', description: 'Salesforce security profiles' },
        { object: 'Simpplr__People_Category__c', description: 'People category definitions' },
      ],

      // Rank 300: Segments & Feed Transfer Initiation
      300: [
        { object: 'Simpplr__Segment__c', description: 'Audience segment definitions' },
      ],

      // Rank 400: Identity & Content Segments
      400: [
        { object: 'Simpplr__Audience__c', description: 'Audience configurations' },
        { object: 'Simpplr__Audience_Member__c', description: 'Audience membership associations' },
      ],

      // Rank 500: User Profiles
      500: [
        { object: 'Simpplr__People__c', description: 'User identity and profile data' },
      ],

      // Rank 600: Application Configuration & Identity Attributes
      600: [
        { object: 'Simpplr__App_Config__c', description: 'Application configuration settings' },
        { object: 'Simpplr__App_Default__c', description: 'Default application settings' },
        { object: 'Simpplr__App_Feature__c', description: 'Application feature flags' },
        { object: 'Simpplr__Help_And_Feedback__c', description: 'User feedback records' },
        { object: 'Simpplr__People_Expertise__c', description: 'User expertise and skills' },
        { object: 'sfLma__License__c', description: 'LMA license records' },
        { object: 'sfFma__Feature_Parameter_Booleans__r', description: 'LMA boolean feature parameters' },
        { object: 'sfFma__Feature_Parameter_Dates__r', description: 'LMA date feature parameters' },
        { object: 'sfFma__Feature_Parameter_Integers__r', description: 'LMA integer feature parameters' },
        { object: 'sfFma__FeatureParameterInteger__c', description: 'Feature parameter integers' },
        { object: 'OrgWideEmailAddress', description: 'Organization-wide email addresses' },
      ],

      // Rank 700: User Settings & Expertise Details
      700: [
        { object: 'Simpplr__People_Expertise_Detail__c', description: 'Detailed expertise information' },
      ],

      // Rank 1300: Content Structure
      1300: [
        { object: 'Simpplr__Folder__c', description: 'File folder structures' },
        { object: 'Simpplr__Topic__c', description: 'Content topics and categories' },
        { object: 'Topic', description: 'Standard Salesforce topics' },
        { object: 'Simpplr__Subscription__c', description: 'Content subscriptions' },
        { object: 'Simpplr__Social_Campaign__c', description: 'Marketing campaign configurations' },
        { object: 'Simpplr__File__c', description: 'File records and metadata' },
        { object: 'ContentDocument', description: 'Standard Salesforce content documents' },
        { object: 'ContentVersion', description: 'Standard Salesforce content versions' },
        { object: 'ContentDocumentLink', description: 'Standard Salesforce content document links' },
      ],

      // Rank 1400: Sites & External Files
      1400: [
        { object: 'Simpplr__Site__c', description: 'Site/intranet configurations' },
        { object: 'Group', description: 'Standard Salesforce groups' },
        { object: 'CollaborationGroup', description: 'Standard Salesforce collaboration groups (Chatter groups)' },
      ],

      // Rank 1500: Page Categories & Video Categories
      1500: [
        { object: 'Simpplr__Page__c', description: 'Page templates and layouts' },
        { object: 'Simpplr__Tile__c', description: 'Dashboard tile configurations' },
        { object: 'Simpplr__Category__c', description: 'Video categories' },
        { object: 'RecordType', description: 'Standard Salesforce record types' },
      ],

      // Rank 1600: Content & Video Permissions
      1600: [
        { object: 'Simpplr__Content__c', description: 'Main content records (blogs, events, albums)' },
        { object: 'Simpplr__Permission_Group__c', description: 'Video permission groups' },
        { object: 'Simpplr__Analytics_Topic_Suggestion__c', description: 'AI-generated topic suggestions' },
      ],

      // Rank 1700: Content Metadata & Events
      1700: [
        { object: 'Simpplr__Content_History__c', description: 'Content version history and revisions' },
        { object: 'Simpplr__Content_Mention__c', description: 'Content mentions and @tags' },
        { object: 'Simpplr__Event__c', description: 'Event records and registrations' },
        { object: 'Simpplr__Must_Read__c', description: 'Must-read content assignments' },
        { object: 'Simpplr__Content_Promotion__c', description: 'Promoted/featured content' },
      ],

      // Rank 1800: Video Info & Permission Members
      1800: [
        { object: 'Simpplr__Video_Info__c', description: 'Video metadata (Kaltura integration)' },
        { object: 'Simpplr__Permission_Group_Member__c', description: 'Permission group member associations' },
      ],

      // Rank 1900: Kaltura Category Entries
      1900: [
        { object: 'Simpplr__Category_Entry__c', description: 'Kaltura category entry mappings' },
      ],

      // Rank 2000: Content Interactions
      2000: [
        { object: 'Simpplr__Like__c', description: 'Content and feed likes/reactions' },
        { object: 'Simpplr__Favourite__c', description: 'Favorited/bookmarked content' },
      ],

      // Rank 2300: User Preferences & Blogs
      2300: [
        { object: 'Simpplr__People_Preference__c', description: 'User preferences and settings' },
      ],

      // Rank 2600: Feed Posts
      2600: [
        { object: 'Simpplr__Feed_Item__c', description: 'Chatter feed posts' },
        { object: 'FeedItem', description: 'Standard Salesforce feed items (Chatter posts)' },
      ],

      // Rank 2700: Q&A Questions
      2700: [
        { object: 'Simpplr__Question__c', description: 'Q&A questions' },
      ],

      // Rank 2800: Feed Comments & Q&A Answers
      2800: [
        { object: 'Simpplr__Feed_Item_Comment__c', description: 'Feed comments and replies' },
        { object: 'FeedComment', description: 'Standard Salesforce feed comments' },
        { object: 'Simpplr__Answer__c', description: 'Q&A answers' },
        { object: 'Simpplr__Feed_Item_Mention__c', description: 'Feed item mentions and @tags' },
      ],

      // Rank 2900: Feed Interactions & Q&A Votes
      2900: [
        { object: 'Simpplr__Vote__c', description: 'Q&A upvotes and downvotes' },
        { object: 'Simpplr__Recognition__c', description: 'Recognition and badges' },
      ],

      // Rank 3000+: Third-Party Systems & Search Indexing
      3000: [
        { object: 'Simpplr__Custom_Metadata__c', description: 'Custom metadata (final sync)' },
      ],
    },

    // Flat list of all Salesforce objects (for backward compatibility and easy iteration)
    // Includes objects extracted via AppFlow AND objects read from PostgreSQL/Odin CDC replica
    objects: [
      // Rank 200
      'User', 'Profile', 'Simpplr__People_Category__c',
      // Rank 300
      'Simpplr__Segment__c',
      // Rank 400
      'Simpplr__Audience__c', 'Simpplr__Audience_Member__c',
      // Rank 500
      'Simpplr__People__c',
      // Rank 600
      'Simpplr__App_Config__c', 'Simpplr__App_Default__c', 'Simpplr__App_Feature__c', 'Simpplr__Help_And_Feedback__c',
      'Simpplr__People_Expertise__c', 'sfLma__License__c', 'sfFma__Feature_Parameter_Booleans__r',
      'sfFma__Feature_Parameter_Dates__r', 'sfFma__Feature_Parameter_Integers__r', 'sfFma__FeatureParameterInteger__c',
      'OrgWideEmailAddress',
      // Rank 700
      'Simpplr__People_Expertise_Detail__c',
      // Rank 1300
      'Simpplr__Folder__c', 'Simpplr__Topic__c', 'Topic', 'Simpplr__Subscription__c',
      'Simpplr__Social_Campaign__c', 'Simpplr__File__c', 'ContentDocument', 'ContentVersion', 'ContentDocumentLink',
      // Rank 1400
      'Simpplr__Site__c', 'Group', 'CollaborationGroup',
      // Rank 1500
      'Simpplr__Page__c', 'Simpplr__Tile__c', 'Simpplr__Category__c', 'RecordType',
      // Rank 1600
      'Simpplr__Content__c', 'Simpplr__Permission_Group__c', 'Simpplr__Analytics_Topic_Suggestion__c',
      // Rank 1700
      'Simpplr__Content_History__c', 'Simpplr__Content_Mention__c', 'Simpplr__Event__c',
      'Simpplr__Must_Read__c', 'Simpplr__Content_Promotion__c',
      // Rank 1800
      'Simpplr__Video_Info__c', 'Simpplr__Permission_Group_Member__c',
      // Rank 1900
      'Simpplr__Category_Entry__c',
      // Rank 2000
      'Simpplr__Like__c', 'Simpplr__Favourite__c',
      // Rank 2300
      'Simpplr__People_Preference__c',
      // Rank 2600
      'Simpplr__Feed_Item__c', 'FeedItem',
      // Rank 2700
      'Simpplr__Question__c',
      // Rank 2800
      'Simpplr__Feed_Item_Comment__c', 'FeedComment', 'Simpplr__Answer__c', 'Simpplr__Feed_Item_Mention__c',
      // Rank 2900
      'Simpplr__Vote__c', 'Simpplr__Recognition__c',
      // Rank 3000
      'Simpplr__Custom_Metadata__c',
    ],

    // Transformation rules per object (for scheduled sync flows)
    objectsToTransfer: [
      // Example transformations - customize based on requirements
      { sourceObject: 'User', destinationTable: 'users', rank: 200 },
      { sourceObject: 'Simpplr__People__c', destinationTable: 'people', rank: 500 },
      { sourceObject: 'Simpplr__Content__c', destinationTable: 'content', rank: 1600 },
    ],
  },
  customers: [
    {
      customerId: 'customer-001',
      name: 'Example Customer 1',
      salesforceOrgId: 'SALESFORCE_ORG_ID_1', // Unique Salesforce Org ID for this customer
      
    },
    // Add more customers as needed
    // {
    //   customerId: 'customer-002',
    //   name: 'Example Customer 2',
    //   salesforceOrgId: 'SALESFORCE_ORG_ID_2'
    // },
  ],

  environments: [
    {
      name: 'dev',
      account: '533101977259',
      region: 'us-east-1',
      requiresApproval: false,

      salesforce: {
        // Salesforce connection configuration
        // This will be used to create AppFlow connections
        secretArn: 'arn:aws:secretsmanager:us-east-1:533101977259:secret:appflow!533101977259-sf-temp-1763741024664-KGA0wB',
        instanceUrl: 'https://protagona-sf-demo.my.salesforce.com', 
      },

      // Reference to existing VPC that contains the RDS instances
      vpcId: 'vpc-0945a7bbfa144b582', // Update with actual VPC ID where RDS instances are located
      rdsConfig: {
        secretArn: 'arn:aws:secretsmanager:us-east-1:533101977259:secret:PostgresDatabaseSecret8058A-wDFf66VGvVsQ-t4BSD6',
      },
    }
  ]
};

export class AppConfig {
    public name: string;
    public version: string;
    public pipeline: PipelineConfig;
    public sandboxEnvironments: SandboxConfig[];
    public appFlowConfig: AppFlowConfig;
    public customers: CustomerConfig[];
    public environments: EnvironmentConfig[] = [];
}

export class SalesforceConfig {
    public secretArn: string;
    public instanceUrl: string;
    public connectorProfileName?: string; // Optional: use existing profile instead of creating new one
}

export class PipelineConfig {
    public account: string;
    public region: string;
    public repositoryName: string;
    public repositoryOwner: string;
    public branch: string;
    public connectionArn: string;
}

export class SandboxConfig {
    public pipelineConfig: PipelineConfig;
    public environmentConfig: EnvironmentConfig;
}

export class EnvironmentConfig {
    public name: string;
    public account: string;
    public region: string;
    public requiresApproval: boolean;
    public salesforce: SalesforceConfig;
    public vpcId: string; // ID of existing VPC that contains RDS instances
    public rdsConfig: RDSConfig;
}

export interface CustomerConfig {
    customerId: string;
    name: string;
    salesforceOrgId: string;
}

export interface RDSConfig {
    database?: string;
    secretArn: string;
}

export interface SalesforceObjectConfig {
    object: string;
    description: string;
}

export interface AppFlowConfig {
    scheduleExpression: string;
    salesforceObjectsByRank: Record<number, SalesforceObjectConfig[]>;
    objects: string[];
    objectsToTransfer: ObjectToTransferConfig[];
}

export interface ObjectToTransferConfig {
    sourceObject: string;
    destinationTable: string;
    rank?: number;
}
