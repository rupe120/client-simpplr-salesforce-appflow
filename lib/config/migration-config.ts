/**
 * Migration-specific configuration for Odin to Zeus migration
 * This extends the base app-config with migration-specific settings
 */

export interface GlueScriptConfig {
  scriptName: string;
  entityName: string;
  description: string;
  dpuAllocation: number;
  timeoutMinutes: number;
  sourceObjects: string[];
  targetSchema: string;
  targetTable: string;
}

export interface RankOrderConfig {
  rank: number;
  description: string;
  dependencies: number[]; // List of rank numbers that must complete first
  glueScripts: GlueScriptConfig[];
}

export interface MigrationConfig {
  // Glue job configuration
  glue: {
    // Default DPU allocation per entity type
    dpuAllocation: Record<string, number>;
    // Glue version
    glueVersion: string;
    // Python version for Glue jobs
    pythonVersion: string;
    // Job timeout in minutes (max 2880 = 48 hours)
    jobTimeout: number;
    // Max retries for failed jobs
    maxRetries: number;
  };

  // Step Functions configuration
  stepFunctions: {
    // State machine timeout in hours
    timeoutHours: number;
    // Retry configuration
    retry: {
      intervalSeconds: number;
      maxAttempts: number;
      backoffRate: number;
    };
  };

  // S3 bucket configuration
  s3: {
    // Raw data retention days
    rawDataRetentionDays: number;
    // Processed data retention days
    processedDataRetentionDays: number;
    // Error data retention days
    errorDataRetentionDays: number;
  };

  // Rank-based execution order with Glue scripts
  rankOrderExecution: RankOrderConfig[];

  // Entity to Glue job mapping (legacy, will be replaced by rankOrderExecution)
  entityJobMapping: Record<string, {
    jobName: string;
    dpuAllocation: number;
    timeoutMinutes: number;
  }>;
}

export const migrationConfig: MigrationConfig = {
  glue: {
    dpuAllocation: {
      // Small entities (quick processing)
      'ps-pre-migration-steps': 2,
      'ps-cust-org-info': 2,
      'ps-cust-app-basic-settings': 2,
      
      // Medium entities
      'identity-users': 5,
      'identity-profiles': 3,
      'identity-followers': 3,
      'cont-sites': 5,
      'cont-pages': 5,
      'cont-content': 10,
      
      // Large entities (millions of records)
      'feed-chatter-feeds': 15,
      'feed-chatter-comments': 15,
      'feed-likes': 10,
      'file-native-files': 20,
      'file-file-metadata': 10,
    },
    glueVersion: '4.0',
    pythonVersion: '3.9',
    jobTimeout: 2880, // 48 hours
    maxRetries: 2,
  },

  stepFunctions: {
    timeoutHours: 24,
    retry: {
      intervalSeconds: 120,
      maxAttempts: 2,
      backoffRate: 2,
    },
  },

  s3: {
    rawDataRetentionDays: 30,
    processedDataRetentionDays: 30,
    errorDataRetentionDays: 90,
  },

  // Rank-based execution order - scripts run after AppFlow completes for each rank
  // Scripts within same rank run in parallel, ranks execute sequentially
  // NOTE: Only uncomment ranks where BOTH AppFlow flows AND Glue scripts are implemented
  rankOrderExecution: [
    // TODO: Uncomment when AppFlow flows are created for these objects
    // {
    //   rank: 200,
    //   description: 'Identity Foundation',
    //   dependencies: [100], // Depends on pre-migration setup
    //   glueScripts: [
    //     {
    //       scriptName: 'identity-people-categories',
    //       entityName: 'identity-people-categories',
    //       description: 'People category definitions',
    //       dpuAllocation: 2,
    //       timeoutMinutes: 10,
    //       sourceObjects: ['Simpplr__People_Category__c'],
    //       targetSchema: 'identity_mgmt',
    //       targetTable: 'people_categories',
    //     },
    //   ],
    // },
    // {
    //   rank: 300,
    //   description: 'Segments',
    //   dependencies: [200],
    //   glueScripts: [
    //     {
    //       scriptName: 'ps-segments',
    //       entityName: 'ps-segments',
    //       description: 'Audience segment definitions',
    //       dpuAllocation: 3,
    //       timeoutMinutes: 15,
    //       sourceObjects: ['Simpplr__Segment__c'],
    //       targetSchema: 'account_app',
    //       targetTable: 'segments',
    //     },
    //   ],
    // },
    // {
    //   rank: 400,
    //   description: 'Identity Segments',
    //   dependencies: [300],
    //   glueScripts: [
    //     {
    //       scriptName: 'identity-segments',
    //       entityName: 'identity-segments',
    //       description: 'Audiences and audience members',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 20,
    //       sourceObjects: ['Simpplr__Audience__c', 'Simpplr__Audience_Member__c'],
    //       targetSchema: 'identity_mgmt',
    //       targetTable: 'audiences',
    //     },
    //   ],
    // },
    // {
    //   rank: 500,
    //   description: 'User Profiles',
    //   dependencies: [400],
    //   glueScripts: [
    //     {
    //       scriptName: 'identity-people',
    //       entityName: 'identity-people',
    //       description: 'Users & People (2-table migration)',
    //       dpuAllocation: 10,
    //       timeoutMinutes: 60,
    //       sourceObjects: ['User', 'Simpplr__People__c'],
    //       targetSchema: 'identity_mgmt',
    //       targetTable: 'people', // Also writes to users table
    //     },
    //   ],
    // },
    // {
    //   rank: 600,
    //   description: 'Application Configuration & Expertise',
    //   dependencies: [500],
    //   glueScripts: [
    //     {
    //       scriptName: 'ps-app-config',
    //       entityName: 'ps-app-config',
    //       description: 'Application configuration settings',
    //       dpuAllocation: 3,
    //       timeoutMinutes: 15,
    //       sourceObjects: ['Simpplr__App_Config__c'],
    //       targetSchema: 'account_app',
    //       targetTable: 'app_configs',
    //     },
    //     {
    //       scriptName: 'ps-app-default',
    //       entityName: 'ps-app-default',
    //       description: 'Default application settings',
    //       dpuAllocation: 2,
    //       timeoutMinutes: 10,
    //       sourceObjects: ['Simpplr__App_Default__c'],
    //       targetSchema: 'account_app',
    //       targetTable: 'app_defaults',
    //     },
    //     {
    //       scriptName: 'ps-ff-sync',
    //       entityName: 'ps-ff-sync',
    //       description: 'Feature Flags (multi-table LMA joins)',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 30,
    //       sourceObjects: [
    //         'sfLma__License__c',
    //         'sfFma__Feature_Parameter_Booleans__r',
    //         'sfFma__Feature_Parameter_Dates__r',
    //         'sfFma__Feature_Parameter_Integers__r',
    //       ],
    //       targetSchema: 'account_app',
    //       targetTable: 'feature_flags',
    //     },
    //     {
    //       scriptName: 'identity-expertise',
    //       entityName: 'identity-expertise',
    //       description: 'Expertise & Endorsements (2-table migration)',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 30,
    //       sourceObjects: ['Simpplr__People_Expertise__c', 'Simpplr__People_Expertise_Detail__c'],
    //       targetSchema: 'identity_mgmt',
    //       targetTable: 'people_expertise', // Also writes to expertise_endorsements
    //     },
    //   ],
    // },
    // {
    //   rank: 700,
    //   description: 'User Followers',
    //   dependencies: [600],
    //   glueScripts: [
    //     {
    //       scriptName: 'feed-user-followers',
    //       entityName: 'feed-user-followers',
    //       description: 'User follower relationships (derived from subscriptions)',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 30,
    //       sourceObjects: ['Simpplr__Subscription__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'user_followers',
    //     },
    //   ],
    // },
    // {
    //   rank: 1300,
    //   description: 'Content Structure',
    //   dependencies: [700],
    //   glueScripts: [
    //     {
    //       scriptName: 'cont-folders',
    //       entityName: 'cont-folders',
    //       description: 'Folder hierarchy',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 20,
    //       sourceObjects: ['Simpplr__Folder__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'folders',
    //     },
    //     {
    //       scriptName: 'cont-topics',
    //       entityName: 'cont-topics',
    //       description: 'Content topics',
    //       dpuAllocation: 3,
    //       timeoutMinutes: 10,
    //       sourceObjects: ['Simpplr__Topic__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'topics',
    //     },
    //     {
    //       scriptName: 'cont-subscriptions',
    //       entityName: 'cont-subscriptions',
    //       description: 'Subscriptions (polymorphic entity lookup)',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 30,
    //       sourceObjects: ['Simpplr__Subscription__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'subscriptions',
    //     },
    //   ],
    // },
    // {
    //   rank: 1400,
    //   description: 'Sites',
    //   dependencies: [1300],
    //   glueScripts: [
    //     {
    //       scriptName: 'cont-sites',
    //       entityName: 'cont-sites',
    //       description: 'Intranet sites',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 20,
    //       sourceObjects: ['Simpplr__Site__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'sites',
    //     },
    //   ],
    // },
    // {
    //   rank: 1500,
    //   description: 'Video Categories',
    //   dependencies: [1400],
    //   glueScripts: [
    //     {
    //       scriptName: 'nv-category',
    //       entityName: 'nv-category',
    //       description: 'Video categories (hierarchical)',
    //       dpuAllocation: 3,
    //       timeoutMinutes: 15,
    //       sourceObjects: ['Simpplr__Category__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'video_categories',
    //     },
    //   ],
    // },
    // {
    //   rank: 1600,
    //   description: 'Content & Video Permissions',
    //   dependencies: [1500],
    //   glueScripts: [
    //     {
    //       scriptName: 'cont-content',
    //       entityName: 'cont-content',
    //       description: 'Main content records (HTML sanitization)',
    //       dpuAllocation: 10,
    //       timeoutMinutes: 60,
    //       sourceObjects: ['Simpplr__Content__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'contents',
    //     },
    //     {
    //       scriptName: 'nv-permission-group',
    //       entityName: 'nv-permission-group',
    //       description: 'Video permission groups',
    //       dpuAllocation: 3,
    //       timeoutMinutes: 15,
    //       sourceObjects: ['Simpplr__Permission_Group__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'video_permission_groups',
    //     },
    //   ],
    // },
    // {
    //   rank: 1700,
    //   description: 'Events & Files',
    //   dependencies: [1600],
    //   glueScripts: [
    //     {
    //       scriptName: 'cont-events',
    //       entityName: 'cont-events',
    //       description: 'Event records',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 20,
    //       sourceObjects: ['Simpplr__Event__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'events',
    //     },
    //     {
    //       scriptName: 'cont-files',
    //       entityName: 'cont-files',
    //       description: 'File metadata (3-table join with ContentDocument/ContentVersion)',
    //       dpuAllocation: 10,
    //       timeoutMinutes: 60,
    //       sourceObjects: ['ContentDocument', 'ContentVersion', 'ContentDocumentLink'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'files',
    //     },
    //   ],
    // },
    // {
    //   rank: 1800,
    //   description: 'Video Info',
    //   dependencies: [1700],
    //   glueScripts: [
    //     {
    //       scriptName: 'nv-video-info',
    //       entityName: 'nv-video-info',
    //       description: 'Video metadata (Kaltura integration)',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 30,
    //       sourceObjects: ['Simpplr__Video_Info__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'videos',
    //     },
    //   ],
    // },
    // {
    //   rank: 2000,
    //   description: 'Content Interactions',
    //   dependencies: [1800],
    //   glueScripts: [
    //     {
    //       scriptName: 'cont-likes',
    //       entityName: 'cont-likes',
    //       description: 'Likes and reactions',
    //       dpuAllocation: 8,
    //       timeoutMinutes: 45,
    //       sourceObjects: ['Simpplr__Like__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'likes',
    //     },
    //   ],
    // },
    // {
    //   rank: 2600,
    //   description: 'Feed Posts',
    //   dependencies: [2000],
    //   glueScripts: [
    //     {
    //       scriptName: 'feed-feed-posts',
    //       entityName: 'feed-feed-posts',
    //       description: 'Chatter feed posts (HTML sanitization)',
    //       dpuAllocation: 15,
    //       timeoutMinutes: 120,
    //       sourceObjects: ['Simpplr__Feed_Item__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'feed_items',
    //     },
    // },
    // {
    //   rank: 2700,
    //   description: 'Q&A Questions',
    //   dependencies: [2600],
    //   glueScripts: [
    //     {
    //       scriptName: 'qna-question',
    //       entityName: 'qna-question',
    //       description: 'Q&A questions',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 30,
    //       sourceObjects: ['Simpplr__Question__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'questions',
    //     },
    //   ],
    // },
    // {
    //   rank: 2800,
    //   description: 'Feed Comments & Q&A Answers',
    //   dependencies: [2700],
    //   glueScripts: [
    //     {
    //       scriptName: 'feed-comments',
    //       entityName: 'feed-comments',
    //       description: 'Feed comments (HTML sanitization)',
    //       dpuAllocation: 15,
    //       timeoutMinutes: 120,
    //       sourceObjects: ['Simpplr__Feed_Item_Comment__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'feed_comments',
    //     },
    //     {
    //       scriptName: 'qna-answer',
    //       entityName: 'qna-answer',
    //       description: 'Q&A answers',
    //       dpuAllocation: 5,
    //       timeoutMinutes: 30,
    //       sourceObjects: ['Simpplr__Answer__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'answers',
    //     },
    //   ],
    // },
    // {
    //   rank: 2900,
    //   description: 'Q&A Votes',
    //   dependencies: [2800],
    //   glueScripts: [
    //     {
    //       scriptName: 'qna-vote',
    //       entityName: 'qna-vote',
    //       description: 'Q&A votes',
    //       dpuAllocation: 3,
    //       timeoutMinutes: 20,
    //       sourceObjects: ['Simpplr__Vote__c'],
    //       targetSchema: 'content_mgmt',
    //       targetTable: 'votes',
    //     },
    //   ],
    // },
  ],

  entityJobMapping: {
    // This will be populated from migration_jobs.json files
    // Format: entityName -> { jobName, dpuAllocation, timeoutMinutes }
  },
};

/**
 * Helper function to get all Glue scripts for a specific rank
 */
export function getGlueScriptsForRank(rank: number): GlueScriptConfig[] {
  const rankConfig = migrationConfig.rankOrderExecution.find(r => r.rank === rank);
  return rankConfig?.glueScripts || [];
}

/**
 * Helper function to get all ranks in execution order
 */
export function getAllRanks(): number[] {
  return migrationConfig.rankOrderExecution.map(r => r.rank).sort((a, b) => a - b);
}

/**
 * Helper function to get Glue script configuration by entity name
 */
export function getGlueScriptByEntity(entityName: string): GlueScriptConfig | undefined {
  for (const rankConfig of migrationConfig.rankOrderExecution) {
    const script = rankConfig.glueScripts.find(s => s.entityName === entityName);
    if (script) {
      return script;
    }
  }
  return undefined;
}

/**
 * Helper function to get all Glue scripts (flattened)
 */
export function getAllGlueScripts(): GlueScriptConfig[] {
  return migrationConfig.rankOrderExecution.flatMap(r => r.glueScripts);
}

/**
 * Helper function to get rank dependencies
 */
export function getRankDependencies(rank: number): number[] {
  const rankConfig = migrationConfig.rankOrderExecution.find(r => r.rank === rank);
  return rankConfig?.dependencies || [];
}

