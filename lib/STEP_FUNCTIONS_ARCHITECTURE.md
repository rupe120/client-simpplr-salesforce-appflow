# Step Functions Migration Architecture

## Overview

The Step Functions state machine orchestrates the complete migration pipeline, coordinating AppFlow data extraction and Glue transformations across multiple execution ranks.

## Execution Flow

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Migration Orchestrator                       │
│                  (Step Functions State Machine)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ├─► Initialize Migration (DynamoDB)
                              │
                              ├─► Rank 200: Identity Foundation
                              │   ├─► AppFlow: Extract Simpplr__People_Category__c
                              │   └─► Glue: identity-people-categories
                              │
                              ├─► Rank 300: Segments
                              │   ├─► AppFlow: Extract Simpplr__Segment__c
                              │   └─► Glue: ps-segments
                              │
                              ├─► Rank 400: Identity Segments
                              │   ├─► AppFlow: Extract Simpplr__Audience__c, Simpplr__Audience_Member__c
                              │   └─► Glue: identity-segments
                              │
                              ├─► Rank 500: User Profiles
                              │   ├─► AppFlow: Extract User, Simpplr__People__c
                              │   └─► Glue: identity-people
                              │
                              ├─► Rank 600: App Config & Expertise (4 scripts in parallel)
                              │   ├─► AppFlow: Extract 7 objects
                              │   └─► Glue: ps-app-config, ps-app-default, ps-ff-sync, identity-expertise
                              │
                              ├─► ... (Ranks 700-2900)
                              │
                              └─► Complete Migration (DynamoDB)
```

### Per-Rank Execution Pattern

Each rank follows this pattern:

```
┌────────────────────────────────────────────────────────────────┐
│                        Rank N Execution                         │
└────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
┌──────────────────┐                       ┌──────────────────┐
│  AppFlow Phase   │                       │   Glue Phase     │
│  (Extract Data)  │────────────────────►  │ (Transform Data) │
└──────────────────┘                       └──────────────────┘
        │                                           │
        │  Parallel Execution:                     │  Parallel Execution:
        ├─► Object 1 → S3                          ├─► Script 1: S3 → Zeus DB
        ├─► Object 2 → S3                          ├─► Script 2: S3 → Zeus DB
        └─► Object N → S3                          └─► Script N: S3 → Zeus DB
                │                                           │
                └───────────► Wait for All ────────────────┘
                                    │
                                    ▼
                              Next Rank (N+1)
```

## State Machine Structure

### 1. Initialize Migration

**Type**: DynamoDB PutItem
**Purpose**: Record migration start in status tracking table

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::aws-sdk:dynamodb:putItem",
  "Parameters": {
    "TableName": "migration-status-{environment}",
    "Item": {
      "tenant_id": { "S.$": "$.tenantId" },
      "migration_id": { "S.$": "$.migrationId" },
      "status": { "S": "IN_PROGRESS" },
      "started_at": { "S.$": "$$.State.EnteredTime" }
    }
  }
}
```

### 2. Rank Execution States

Each rank creates two parallel execution groups:

#### a. AppFlow Extraction Parallel State

**Type**: Parallel
**Purpose**: Extract all Salesforce objects needed for this rank

```json
{
  "Type": "Parallel",
  "Comment": "Extract Salesforce data for rank {N} objects",
  "Branches": [
    {
      "StartAt": "StartFlow-{rank}-{object1}",
      "States": {
        "StartFlow-{rank}-{object1}": {
          "Type": "Task",
          "Resource": "arn:aws:states:::aws-sdk:appflow:startFlow",
          "Parameters": {
            "FlowName": "migration-{customer}-{object1}"
          },
          "Retry": [
            {
              "ErrorEquals": ["AppFlowException", "States.TaskFailed"],
              "IntervalSeconds": 30,
              "MaxAttempts": 2,
              "BackoffRate": 2
            }
          ],
          "Catch": [
            {
              "ErrorEquals": ["States.ALL"],
              "Next": "NotifyAppFlowFailure"
            }
          ]
        }
      }
    }
    // ... more branches for each source object
  ],
  "Next": "GlueTransformation-Rank{N}"
}
```

#### b. Glue Transformation Parallel State

**Type**: Parallel
**Purpose**: Transform and load data for all scripts in this rank

```json
{
  "Type": "Parallel",
  "Comment": "Transform and load data for rank {N}",
  "Branches": [
    {
      "StartAt": "StartGlue-{rank}-{script1}",
      "States": {
        "StartGlue-{rank}-{script1}": {
          "Type": "Task",
          "Resource": "arn:aws:states:::aws-sdk:glue:startJobRun",
          "Parameters": {
            "JobName": "migration-{script1}-{environment}",
            "Arguments": {
              "--TENANT_ID.$": "$.tenantId",
              "--ENTITY_NAME": "{script1}",
              "--TARGET_SCHEMA": "{schema}",
              "--TARGET_TABLE": "{table}"
            }
          },
          "Retry": [
            {
              "ErrorEquals": ["Glue.ConcurrentRunsExceededException", "States.TaskFailed"],
              "IntervalSeconds": 120,
              "MaxAttempts": 2,
              "BackoffRate": 2
            }
          ],
          "Catch": [
            {
              "ErrorEquals": ["States.ALL"],
              "Next": "NotifyGlueFailure"
            }
          ]
        }
      }
    }
    // ... more branches for each Glue script
  ],
  "Next": "Rank{N+1}" // or "CompleteMigration" if last rank
}
```

### 3. Complete Migration

**Type**: DynamoDB UpdateItem
**Purpose**: Mark migration as complete

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::aws-sdk:dynamodb:updateItem",
  "Parameters": {
    "TableName": "migration-status-{environment}",
    "Key": {
      "tenant_id": { "S.$": "$.tenantId" },
      "migration_id": { "S.$": "$.migrationId" }
    },
    "UpdateExpression": "SET #status = :status, #completed_at = :completed_at",
    "ExpressionAttributeNames": {
      "#status": "status",
      "#completed_at": "completed_at"
    },
    "ExpressionAttributeValues": {
      ":status": { "S": "COMPLETED" },
      ":completed_at": { "S.$": "$$.State.EnteredTime" }
    }
  },
  "End": true
}
```

## Rank Execution Details

### Rank 200: Identity Foundation
- **AppFlow Objects**: 1 (Simpplr__People_Category__c)
- **Glue Scripts**: 1 (identity-people-categories)
- **Dependencies**: Rank 100 (pre-migration)
- **Estimated Time**: 5-10 minutes

### Rank 300: Segments
- **AppFlow Objects**: 1 (Simpplr__Segment__c)
- **Glue Scripts**: 1 (ps-segments)
- **Dependencies**: Rank 200
- **Estimated Time**: 10-15 minutes

### Rank 600: App Config & Expertise
- **AppFlow Objects**: 7 (App_Config, App_Default, 4x LMA objects, 2x Expertise)
- **Glue Scripts**: 4 (ps-app-config, ps-app-default, ps-ff-sync, identity-expertise)
- **Dependencies**: Rank 500
- **Estimated Time**: 30-45 minutes
- **Note**: Highest parallelism (4 Glue jobs simultaneously)

### Rank 2800: Feed Comments & Q&A Answers
- **AppFlow Objects**: 2 (Simpplr__Feed_Item_Comment__c, Simpplr__Answer__c)
- **Glue Scripts**: 2 (feed-comments, qna-answer)
- **Dependencies**: Rank 2700
- **Estimated Time**: 2-3 hours
- **Note**: High data volume (millions of records)

## Error Handling

### AppFlow Failures

**Retry Strategy**:
- Errors: `AppFlowException`, `States.TaskFailed`
- Interval: 30 seconds
- Max Attempts: 2
- Backoff Rate: 2x

**Failure Actions**:
1. Publish SNS notification with:
   - Rank number
   - Source object
   - Error details
2. Continue to next parallel branch
3. Rank fails if ANY AppFlow extraction fails

### Glue Job Failures

**Retry Strategy**:
- Errors: `Glue.ConcurrentRunsExceededException`, `States.TaskFailed`
- Interval: 120 seconds (configurable via migration-config)
- Max Attempts: 2 (configurable)
- Backoff Rate: 2x (configurable)

**Failure Actions**:
1. Publish SNS notification with:
   - Rank number
   - Entity name
   - Error details
2. Continue to next parallel branch
3. Rank fails if ANY Glue transformation fails

## Input Format

State machine expects this input:

```json
{
  "tenantId": "customer-001",
  "migrationId": "migration-2025-01-20-001",
  "environment": "dev"
}
```

## Output Format

Successful execution returns:

```json
{
  "tenantId": "customer-001",
  "migrationId": "migration-2025-01-20-001",
  "initResult": { /* DynamoDB put result */ },
  "appflow": {
    "Simpplr__People_Category__c": { /* AppFlow execution */ },
    "Simpplr__Segment__c": { /* AppFlow execution */ }
    // ... one entry per source object
  },
  "glue": {
    "identity-people-categories": { /* Glue job run */ },
    "ps-segments": { /* Glue job run */ }
    // ... one entry per Glue script
  },
  "completeResult": { /* DynamoDB update result */ }
}
```

## Monitoring

### CloudWatch Logs

All state machine executions log to:
```
/aws/vendedlogs/states/{app-name}-migration-stepfunctions-{environment}
```

**Log Level**: ALL (includes input/output data)

### SNS Notifications

Failure notifications published to:
```
arn:aws:sns:{region}:{account}:{app-name}-migration-stepfunctions-{environment}-failures
```

**Notification Format**:
```json
{
  "rank": 600,
  "sourceObject": "Simpplr__App_Config__c",  // for AppFlow failures
  "entity": "ps-app-config",                  // for Glue failures
  "error": {
    "Error": "States.TaskFailed",
    "Cause": "..."
  },
  "message": "AppFlow extraction failed for Simpplr__App_Config__c in rank 600"
}
```

### DynamoDB Tracking

Migration status tracked in:
```
migration-status-{environment}
```

**Schema**:
```typescript
{
  tenant_id: string;        // Partition key
  migration_id: string;     // Sort key
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  started_at: string;       // ISO 8601 timestamp
  completed_at?: string;    // ISO 8601 timestamp
}
```

## Performance Characteristics

### Parallelism

**AppFlow Phase**:
- Up to N flows in parallel (where N = unique source objects in rank)
- Example: Rank 600 runs 7 AppFlow flows simultaneously

**Glue Phase**:
- Up to M jobs in parallel (where M = Glue scripts in rank)
- Example: Rank 600 runs 4 Glue jobs simultaneously

### Execution Time Estimates

| Ranks | Objects | Scripts | Est. Time | Bottleneck |
|-------|---------|---------|-----------|------------|
| 200-500 | 5 | 4 | 1-2 hours | User data volume |
| 600-1500 | 15 | 9 | 2-3 hours | Content metadata |
| 1600-2000 | 8 | 5 | 3-4 hours | Content volume |
| 2600-2900 | 5 | 6 | 4-8 hours | Feed data volume |
| **Total** | **33** | **20** | **10-17 hours** | Feed processing |

**Note**: Times vary significantly based on tenant data volume

## Resource Requirements

### Peak Concurrency

**Maximum Parallel Executions**:
- AppFlow: 7 flows (Rank 600)
- Glue: 4 jobs (Rank 600)
- Total DPU: 147 (theoretical max if all ran simultaneously)
- Actual Peak DPU: 20 (Rank 2800: 15 + 5)

### Costs (Estimated per 1M records)

**AppFlow**:
- $0.001 per row processed
- Estimated: $1,000 per full migration

**Glue**:
- $0.44 per DPU-hour
- Estimated: $200-400 per full migration

**Step Functions**:
- $0.025 per 1,000 state transitions
- Estimated: $5-10 per migration

**Total**: ~$1,200-1,400 per full tenant migration

## Optimization Strategies

### 1. Reduce Rank Count

Combine compatible ranks (same dependencies) to reduce sequential execution time.

**Example**: Ranks 1300-1500 could potentially run in parallel if content structure dependencies allow.

### 2. Increase Glue DPU

For high-volume entities:
- feed-feed-posts: Increase from 15 to 20 DPU (-30% runtime)
- feed-comments: Increase from 15 to 20 DPU (-30% runtime)

### 3. Use Parquet Instead of JSON

AppFlow output format:
- JSON: Human-readable, easier debugging
- Parquet: 10x faster Glue processing, 70% smaller storage

**Recommendation**: Use JSON for dev/test, Parquet for production

### 4. Parallel Rank Execution

Some ranks can run in parallel if dependencies allow:

```
Rank 1300 (cont-folders, cont-topics)
    ├─► Rank 1400 (cont-sites)
    └─► Rank 1500 (nv-category)  ← Could run in parallel with 1400
```

## Troubleshooting

### Common Issues

**Issue**: AppFlow flow not found
**Cause**: Source object not configured in app-config.ts
**Solution**: Add object to `salesforceObjectsByRank`

---

**Issue**: Glue job not found
**Cause**: Glue script not implemented or not deployed
**Solution**: Check `src-backend/glue-jobs/{script-name}/script.py` exists

---

**Issue**: Rank execution timeout
**Cause**: Data volume exceeded timeout estimate
**Solution**: Increase Glue DPU allocation or split rank

---

**Issue**: Foreign key constraint violations
**Cause**: Rank ordering incorrect or parent data missing
**Solution**: Verify rank dependencies in migration-config.ts

## References

- [migration-config.ts](./config/migration-config.ts) - Rank order configuration
- [migration-stepfunctions-stack.ts](./migration-stepfunctions-stack.ts) - Stack implementation
- [Glue Scripts](../src-backend/glue-jobs/) - Transformation logic
- [MIGRATION_IMPLEMENTATION_PLAN.md](../MIGRATION_IMPLEMENTATION_PLAN.md) - Overall plan
