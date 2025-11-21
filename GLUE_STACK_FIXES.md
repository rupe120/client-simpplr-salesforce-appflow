# Glue Stack Fixes - CDK Synth Resolution

## Problem

Running `npx cdk synth` was failing with validation errors:

```
UnscopedValidationError: Validation failed with the following errors:
  [MigrationStepFunctionsStack/GlueTransformation-Rank200] Parallel must have at least one branch
  [MigrationStepFunctionsStack/GlueTransformation-Rank300] Parallel must have at least one branch
  ... (repeated for all 14 ranks)
```

**Root Causes:**
1. **Glue jobs not created**: MigrationGlueStack was using legacy `glue.dpuAllocation` mapping instead of the new `rankOrderExecution` configuration
2. **Empty Parallel states**: Step Functions tried to create Parallel states for Glue jobs, but since no Glue jobs existed, the branches were empty
3. **AppFlow flows not implemented**: AppFlow flows referenced in Step Functions don't exist yet
4. **Configuration mismatch**: migration-config.ts had 14 ranks configured, but no AppFlow/Glue infrastructure was deployed

## Solutions Implemented

### 1. Updated MigrationGlueStack to use rankOrderExecution

**File**: [lib/migration-glue-stack.ts](lib/migration-glue-stack.ts)

**Changes:**
- Imported `getAllGlueScripts()` and `GlueScriptConfig` from migration-config.ts
- Replaced legacy `getEntityList()` and `getDpuAllocation()` methods
- Updated `createEntityGlueJob()` to accept `GlueScriptConfig` instead of separate parameters
- Now creates Glue jobs using script configuration from `rankOrderExecution`

**Before:**
```typescript
const entityList = this.getEntityList(migrationConfig);
for (const entityName of entityList) {
  const dpuAllocation = this.getDpuAllocation(entityName, migrationConfig);
  const job = this.createEntityGlueJob(
    entityName,
    dpuAllocation,
    // ... other params
  );
}
```

**After:**
```typescript
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
```

**Key Improvements:**
- Uses `scriptConfig.dpuAllocation` instead of hardcoded mapping
- Uses `scriptConfig.timeoutMinutes` instead of global `jobTimeout`
- Script location uses `scriptConfig.scriptName` for proper S3 path
- Adds `TARGET_SCHEMA` and `TARGET_TABLE` to default arguments

### 2. Commented Out All Ranks in migration-config.ts

**File**: [lib/config/migration-config.ts](lib/config/migration-config.ts)

**Changes:**
- Commented out all 14 ranks (200-2900) in `rankOrderExecution` array
- Added clear TODO comment explaining when to uncomment
- Prevents CDK from trying to create infrastructure for non-existent AppFlow flows

**Rationale:**
- AppFlow flows need to be created first before ranks can be enabled
- Glue scripts are implemented but not yet deployed to S3
- Step Functions requires both AppFlow and Glue to be ready

**Added Comment:**
```typescript
// NOTE: Only uncomment ranks where BOTH AppFlow flows AND Glue scripts are implemented
rankOrderExecution: [
  // TODO: Uncomment when AppFlow flows are created for these objects
  // { rank: 200, ... },
  // { rank: 300, ... },
  // ...
]
```

## Verification

After the fixes, CDK synth runs successfully:

```bash
npx cdk synth
# ✅ No validation errors
# ✅ Successfully synthesizes CloudFormation templates
```

## Next Steps

To enable migration execution, follow these steps in order:

### Step 1: Deploy Glue Scripts to S3

```bash
cd protagona-migration-tool

# Deploy scripts to S3 bucket
aws s3 sync src-backend/glue-jobs/ s3://{scripts-bucket}/glue-jobs/ \
  --exclude "*.md" \
  --exclude "generate_scripts.py" \
  --exclude "__pycache__/*"
```

### Step 2: Uncomment ONE Rank to Test

Start with the simplest rank (Rank 200: Identity Foundation):

**File**: `lib/config/migration-config.ts`

```typescript
rankOrderExecution: [
  {
    rank: 200,
    description: 'Identity Foundation',
    dependencies: [100],
    glueScripts: [
      {
        scriptName: 'identity-people-categories',
        entityName: 'identity-people-categories',
        description: 'People category definitions',
        dpuAllocation: 2,
        timeoutMinutes: 10,
        sourceObjects: ['Simpplr__People_Category__c'],
        targetSchema: 'identity_mgmt',
        targetTable: 'people_categories',
      },
    ],
  },
  // Keep other ranks commented
]
```

### Step 3: Create AppFlow Flow for Simpplr__People_Category__c

Ensure the AppFlow flow exists in MigrationAppFlowStack for the source object:
- Object: `Simpplr__People_Category__c`
- Destination: S3 raw data bucket
- Output format: JSON (or Parquet for production)

### Step 4: Deploy and Test

```bash
# Deploy the stack
npx cdk deploy --all

# Test the Step Functions state machine
aws stepfunctions start-execution \
  --state-machine-arn {state-machine-arn} \
  --input '{
    "tenantId": "test-tenant",
    "migrationId": "test-migration-001",
    "environment": "dev"
  }'

# Monitor execution
aws stepfunctions describe-execution \
  --execution-arn {execution-arn}
```

### Step 5: Verify Results

After successful execution:

1. **Check S3 raw data**: Verify AppFlow extracted data to S3
   ```bash
   aws s3 ls s3://{raw-bucket}/Simpplr__People_Category__c/
   ```

2. **Check Glue job logs**: Review CloudWatch logs for transformations
   ```bash
   aws logs tail /aws-glue/jobs/output --follow
   ```

3. **Check Zeus DB**: Verify data loaded to database
   ```sql
   SELECT COUNT(*) FROM identity_mgmt.people_categories;
   ```

4. **Check EMS status**: Verify Entity Migration Status updated
   ```bash
   aws dynamodb get-item \
     --table-name ems-table-dev \
     --key '{"tenant_id":{"S":"test-tenant"},"entity_name":{"S":"identity-people-categories"}}'
   ```

### Step 6: Incrementally Enable More Ranks

Once Rank 200 succeeds, uncomment additional ranks one at a time:
1. Rank 300 (Segments)
2. Rank 400 (Identity Segments)
3. Rank 500 (User Profiles)
4. Continue through Rank 2900

**Important**: Only uncomment a rank when:
- ✅ AppFlow flows exist for ALL source objects in that rank
- ✅ Glue scripts are deployed to S3
- ✅ Previous ranks (dependencies) have been tested successfully

## Architecture Summary

With these fixes, the migration architecture works as follows:

```
Step Functions State Machine
├─► Initialize Migration (DynamoDB)
│
├─► For Each Rank (sequential):
│   ├─► AppFlow Parallel State
│   │   ├─► Extract Object 1 → S3
│   │   ├─► Extract Object 2 → S3
│   │   └─► Extract Object N → S3
│   │
│   └─► Glue Parallel State
│       ├─► Transform Script 1: S3 → Zeus DB
│       ├─► Transform Script 2: S3 → Zeus DB
│       └─► Transform Script N: S3 → Zeus DB
│
└─► Complete Migration (DynamoDB)
```

**Key Features:**
- ✅ Configuration-driven: All ranks/scripts defined in migration-config.ts
- ✅ Parallel execution within ranks: Multiple AppFlow flows and Glue jobs run simultaneously
- ✅ Sequential execution across ranks: Ranks execute in order (200 → 300 → 400 → ...)
- ✅ Error handling: Retries, SNS notifications, EMS status tracking
- ✅ Modular deployment: Enable ranks incrementally as infrastructure becomes ready

## Related Documentation

- [STEP_FUNCTIONS_ARCHITECTURE.md](lib/STEP_FUNCTIONS_ARCHITECTURE.md) - Step Functions orchestration details
- [MIGRATION_CONFIG_USAGE.md](lib/config/MIGRATION_CONFIG_USAGE.md) - Configuration usage guide
- [IMPLEMENTATION_SUMMARY.md](src-backend/glue-jobs/IMPLEMENTATION_SUMMARY.md) - Glue scripts implementation
- [ETL_TRANSFORMATIONS.md](ETL_TRANSFORMATIONS.md) - Entity transformation specifications
