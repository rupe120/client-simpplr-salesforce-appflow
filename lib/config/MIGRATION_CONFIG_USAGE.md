# Migration Configuration Usage Guide

## Overview

The `migration-config.ts` file provides a comprehensive, rank-ordered configuration for all Glue ETL scripts in the migration pipeline. This configuration drives the Step Functions state machine that orchestrates the entire migration process.

## Configuration Structure

### RankOrderConfig

Each rank represents a sequential execution stage in the migration:

```typescript
interface RankOrderConfig {
  rank: number;              // Execution order (200, 300, 400, ...)
  description: string;       // Human-readable description
  dependencies: number[];    // List of rank numbers that must complete first
  glueScripts: GlueScriptConfig[];  // Scripts to run in parallel within this rank
}
```

### GlueScriptConfig

Each Glue script configuration includes:

```typescript
interface GlueScriptConfig {
  scriptName: string;        // Script folder name (e.g., 'identity-people')
  entityName: string;        // Entity identifier
  description: string;       // What this script does
  dpuAllocation: number;     // DPU (Data Processing Units) allocated
  timeoutMinutes: number;    // Max execution time in minutes
  sourceObjects: string[];   // Salesforce objects read by this script
  targetSchema: string;      // Zeus DB schema (e.g., 'identity_mgmt')
  targetTable: string;       // Zeus DB table name
}
```

## Execution Model

### Sequential Ranks
Ranks execute **sequentially** in order (200 → 300 → 400 → ...):
- Rank 300 waits for Rank 200 to complete
- Rank 400 waits for Rank 300 to complete
- And so on...

### Parallel Scripts
Scripts **within the same rank** execute in **parallel**:
- All scripts in Rank 600 start simultaneously
- The rank is complete when ALL scripts finish
- This maximizes throughput while respecting dependencies

### Dependencies
Each rank declares its dependencies:
```typescript
{
  rank: 600,
  dependencies: [500],  // Rank 600 waits for Rank 500
  glueScripts: [...]
}
```

## Helper Functions

### Get Scripts for a Specific Rank

```typescript
import { getGlueScriptsForRank } from './config/migration-config';

const rank600Scripts = getGlueScriptsForRank(600);
// Returns: [ps-app-config, ps-app-default, ps-ff-sync, identity-expertise]
```

### Get All Ranks in Order

```typescript
import { getAllRanks } from './config/migration-config';

const ranks = getAllRanks();
// Returns: [200, 300, 400, 500, 600, 700, 1300, 1400, ...]
```

### Get Script by Entity Name

```typescript
import { getGlueScriptByEntity } from './config/migration-config';

const script = getGlueScriptByEntity('identity-people');
// Returns: { scriptName: 'identity-people', dpuAllocation: 10, ... }
```

### Get All Scripts (Flattened)

```typescript
import { getAllGlueScripts } from './config/migration-config';

const allScripts = getAllGlueScripts();
// Returns: Array of all 20 GlueScriptConfig objects
```

### Get Rank Dependencies

```typescript
import { getRankDependencies } from './config/migration-config';

const deps = getRankDependencies(600);
// Returns: [500]
```

## Usage in CDK Stack

### Create Glue Jobs

```typescript
import { getAllGlueScripts } from '../config/migration-config';

// Create a Glue job for each script
const glueJobs = getAllGlueScripts().map(scriptConfig => {
  return new glue.CfnJob(this, `GlueJob-${scriptConfig.entityName}`, {
    name: `migration-${scriptConfig.entityName}-${environment}`,
    role: glueServiceRole.roleArn,
    command: {
      name: 'glueetl',
      scriptLocation: `s3://${scriptsBucket.bucketName}/glue-jobs/${scriptConfig.scriptName}/script.py`,
      pythonVersion: '3'
    },
    glueVersion: '4.0',
    maxCapacity: scriptConfig.dpuAllocation,
    timeout: scriptConfig.timeoutMinutes,
    defaultArguments: {
      '--ENTITY_NAME': scriptConfig.entityName,
      '--TARGET_SCHEMA': scriptConfig.targetSchema,
      '--TARGET_TABLE': scriptConfig.targetTable,
      // ... other arguments
    }
  });
});
```

### Generate Step Functions State Machine

```typescript
import { getAllRanks, getGlueScriptsForRank } from '../config/migration-config';

const ranks = getAllRanks();

// Build state machine definition
const states: Record<string, any> = {};

ranks.forEach(rank => {
  const scripts = getGlueScriptsForRank(rank);

  // Create parallel state for this rank
  states[`Rank${rank}`] = {
    Type: 'Parallel',
    Branches: scripts.map(script => ({
      StartAt: `Run-${script.entityName}`,
      States: {
        [`Run-${script.entityName}`]: {
          Type: 'Task',
          Resource: 'arn:aws:states:::glue:startJobRun.sync',
          Parameters: {
            JobName: `migration-${script.entityName}-${environment}`,
            Arguments: {
              '--ENTITY_NAME': script.entityName,
              '--TENANT_ID.$': '$.tenantId'
            }
          },
          End: true
        }
      }
    })),
    Next: ranks[ranks.indexOf(rank) + 1] ? `Rank${ranks[ranks.indexOf(rank) + 1]}` : 'Complete'
  };
});
```

## DPU Allocation Guidelines

DPU allocations are configured based on expected data volume and processing complexity:

| DPU Range | Entity Type | Examples |
|-----------|-------------|----------|
| 2-3 | Small (< 10K records) | Categories, topics, segments |
| 5 | Medium (10K-100K records) | Sites, folders, expertise |
| 8-10 | Large (100K-1M records) | Content, users, likes |
| 15 | Very Large (1M+ records) | Feed posts, feed comments |
| 20 | Extremely Large (5M+ records) | Files (future) |

### Complex Transformations
Higher DPU allocations for complex patterns:
- **2-table migrations**: +2 DPU (identity-people: 10 DPU)
- **Multi-table joins**: +2-3 DPU (ps-ff-sync: 5 DPU, cont-files: 10 DPU)
- **HTML sanitization**: +2 DPU (cont-content: 10 DPU, feed posts: 15 DPU)

## Timeout Guidelines

Timeout allocations based on expected processing time:

| Timeout | Entity Type | Examples |
|---------|-------------|----------|
| 10-15 min | Small entities | Categories, topics |
| 20-30 min | Medium entities | Sites, folders, expertise |
| 45-60 min | Large entities | Content, users |
| 120 min | Very large entities | Feed posts, feed comments |

**Safety Margin**: Timeouts are set 2-3x expected processing time to handle variability.

## Rank Order Breakdown

### Rank 200: Identity Foundation
- **Scripts**: 1 (identity-people-categories)
- **Purpose**: Foundation for user categorization
- **Total DPU**: 2

### Rank 300: Segments
- **Scripts**: 1 (ps-segments)
- **Purpose**: Audience segmentation
- **Total DPU**: 3

### Rank 400: Identity Segments
- **Scripts**: 1 (identity-segments)
- **Purpose**: Audience assignments
- **Total DPU**: 5

### Rank 500: User Profiles
- **Scripts**: 1 (identity-people)
- **Purpose**: User and people records
- **Total DPU**: 10
- **Note**: 2-table migration (users + people)

### Rank 600: Application Configuration & Expertise
- **Scripts**: 4 (ps-app-config, ps-app-default, ps-ff-sync, identity-expertise)
- **Purpose**: App settings and user expertise
- **Total DPU**: 13
- **Parallelism**: All 4 scripts run simultaneously

### Rank 700: User Followers
- **Scripts**: 1 (feed-user-followers)
- **Purpose**: Follower relationships
- **Total DPU**: 5

### Rank 1300: Content Structure
- **Scripts**: 3 (cont-folders, cont-topics, cont-subscriptions)
- **Purpose**: Content organization
- **Total DPU**: 13

### Rank 1400: Sites
- **Scripts**: 1 (cont-sites)
- **Purpose**: Intranet sites
- **Total DPU**: 5

### Rank 1500: Video Categories
- **Scripts**: 1 (nv-category)
- **Purpose**: Video categorization
- **Total DPU**: 3

### Rank 1600: Content & Video Permissions
- **Scripts**: 2 (cont-content, nv-permission-group)
- **Purpose**: Main content and permissions
- **Total DPU**: 13

### Rank 1700: Events & Files
- **Scripts**: 2 (cont-events, cont-files)
- **Purpose**: Events and file metadata
- **Total DPU**: 15
- **Note**: cont-files does 3-table join

### Rank 1800: Video Info
- **Scripts**: 1 (nv-video-info)
- **Purpose**: Video metadata
- **Total DPU**: 5

### Rank 2000: Content Interactions
- **Scripts**: 1 (cont-likes)
- **Purpose**: Likes and reactions
- **Total DPU**: 8

### Rank 2600: Feed Posts
- **Scripts**: 1 (feed-feed-posts)
- **Purpose**: Chatter feed posts
- **Total DPU**: 15
- **Note**: High volume + HTML sanitization

### Rank 2700: Q&A Questions
- **Scripts**: 1 (qna-question)
- **Purpose**: Q&A questions
- **Total DPU**: 5

### Rank 2800: Feed Comments & Q&A Answers
- **Scripts**: 2 (feed-comments, qna-answer)
- **Purpose**: Comments and answers
- **Total DPU**: 20
- **Note**: feed-comments has high volume

### Rank 2900: Q&A Votes
- **Scripts**: 1 (qna-vote)
- **Purpose**: Q&A voting
- **Total DPU**: 3

## Total Resource Requirements

- **Total Scripts**: 20
- **Total Ranks**: 14
- **Total DPU**: 147 (if all scripts run simultaneously - not realistic)
- **Peak DPU per Rank**: 20 (Rank 2800)
- **Estimated Total Execution Time**: 6-12 hours (depending on data volume)

## Monitoring and Observability

Each Glue script execution should emit:
- **CloudWatch Logs**: Job output, errors, warnings
- **CloudWatch Metrics**: Records processed, execution time, DPU usage
- **EMS Updates**: Entity Migration Status in DynamoDB
- **S3 Artifacts**: Processed data (Parquet), error records

## Error Handling

Step Functions retry configuration (from migration-config):
```typescript
retry: {
  intervalSeconds: 120,    // Wait 2 minutes before retry
  maxAttempts: 2,          // Retry up to 2 times
  backoffRate: 2           // Double wait time on each retry
}
```

## Next Steps

1. **CDK Integration**: Use helper functions to generate Glue jobs in `migration-glue-stack.ts`
2. **State Machine Generation**: Auto-generate Step Functions definition from rank order config
3. **Monitoring Setup**: Configure CloudWatch dashboards for each rank
4. **Cost Optimization**: Monitor DPU usage and adjust allocations based on actual data volume

## References

- [migration-config.ts](./migration-config.ts) - Full configuration
- [MIGRATION_IMPLEMENTATION_PLAN.md](../../MIGRATION_IMPLEMENTATION_PLAN.md) - Overall migration plan
- [Glue Scripts Documentation](../../src-backend/glue-jobs/README.md) - Script implementation details
