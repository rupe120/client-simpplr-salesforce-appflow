/**
 * Migration-specific configuration for Odin to Zeus migration
 * This extends the base app-config with migration-specific settings
 */

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

  // Entity to Glue job mapping
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

  entityJobMapping: {
    // This will be populated from migration_jobs.json files
    // Format: entityName -> { jobName, dpuAllocation, timeoutMinutes }
  },
};

