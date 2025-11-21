# AWS Glue ETL Scripts

This directory contains AWS Glue PySpark scripts for migrating Salesforce data from S3 (AppFlow output) to Zeus DB (PostgreSQL).

## Directory Structure

```
glue-jobs/
├── common/
│   ├── glue_utils.py          # Common utilities, UDFs, and context management
│   └── base_script.py         # Base template for ETL jobs
├── ps-app-config/
│   └── script.py              # App configuration migration
├── ps-app-default/
│   └── script.py              # App defaults migration
├── ps-segments/
│   └── script.py              # Segments migration
├── ps-ff-sync/
│   └── script.py              # Feature flags sync
├── identity-people/
│   └── script.py              # User & People migration
├── identity-people-categories/
│   └── script.py              # People categories migration
├── identity-segments/
│   └── script.py              # Audiences & audience members migration
├── identity-expertise/
│   └── script.py              # User expertise & endorsements
├── cont-content/
│   └── script.py              # Content migration (blogs, events, albums)
├── cont-sites/
│   └── script.py              # Sites migration
├── cont-folders/
│   └── script.py              # Folder hierarchy migration
├── cont-files/
│   └── script.py              # File metadata migration
├── cont-topics/
│   └── script.py              # Topics migration
├── cont-subscriptions/
│   └── script.py              # Subscriptions migration
├── cont-events/
│   └── script.py              # Event details migration
├── cont-likes/
│   └── script.py              # Likes migration
├── feed-feed-posts/
│   └── script.py              # Feed posts migration
├── feed-comments/
│   └── script.py              # Feed comments migration
├── feed-user-followers/
│   └── script.py              # User followers migration
├── qna-question/
│   └── script.py              # Q&A questions migration
├── qna-answer/
│   └── script.py              # Q&A answers migration
├── qna-vote/
│   └── script.py              # Q&A votes migration
├── nv-category/
│   └── script.py              # Video categories migration
├── nv-video-info/
│   └── script.py              # Video metadata migration
├── nv-permission-group/
│   └── script.py              # Video permission groups migration
└── nv-category-entry/
    └── script.py              # Video category mappings migration
```

## Common Utilities (`common/glue_utils.py`)

### GlueETLContext

The `GlueETLContext` class provides:

- **Database Connections**: Automatically retrieves credentials from AWS Secrets Manager
- **ID Mapping Cache**: Loads and caches Salesforce ID → Zeus UUID mappings for FK lookups
- **S3 Read/Write**: Helper methods for reading AppFlow output and writing processed data
- **Zeus DB Write**: Simplified JDBC write operations
- **EMS Updates**: Updates Entity Migration Status in DynamoDB

### User-Defined Functions (UDFs)

- `generate_uuid()`: Generate UUID v4 for new records
- `sanitize_html(html)`: Sanitize HTML content
- `parse_json_field(json)`: Parse and validate JSON strings
- `create_lookup_udf(context, entity_type)`: Create UDF for FK lookups
- `validate_email(col_name)`: Validate email format
- `coalesce_int/coalesce_bool(col_name, default)`: Handle nulls with defaults

## Script Pattern

All entity scripts follow this pattern:

```python
def transform_<entity>(source_df, context, spark):
    """Transform source data to target format"""

    # 1. Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)

    # 2. Create lookup UDFs for FKs
    lookup_user_id = create_lookup_udf(context, 'users')

    # 3. Transform data
    transformed_df = source_df.filter(
        # Filter conditions
    ).select(
        # Field mappings
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        # ... more fields
    )

    return transformed_df

if __name__ == "__main__":
    run_etl_job(
        entity_name="entity-name",
        s3_source_path="salesforce/Object__c/",
        target_schema="target_schema",
        target_table="target_table",
        transform_fn=transform_<entity>
    )
```

## Deployment

### Upload to S3

Scripts are uploaded to the Glue scripts bucket during CDK deployment:

```bash
aws s3 sync src-backend/glue-jobs/ s3://{scripts-bucket}/glue-jobs/
```

### Glue Job Configuration

Each script is configured as a Glue job in `migration-glue-stack.ts`:

```typescript
const job = new glue.CfnJob(this, `GlueJob-${entityName}`, {
  name: `migration-${entityName}-${environment}`,
  role: glueServiceRole.roleArn,
  command: {
    name: 'glueetl',
    scriptLocation: `s3://${scriptsBucket.bucketName}/glue-jobs/${entityName}/script.py`,
    pythonVersion: '3'
  },
  glueVersion: '4.0',
  maxCapacity: dpuAllocation,
  defaultArguments: {
    '--ENTITY_NAME': entityName,
    '--TENANT_ID': context.tenantId,
    '--ZEUS_DB_SECRET_ARN': zeusDbSecret.secretArn,
    // ... other arguments
  }
});
```

## Execution Flow

1. **AppFlow Extraction**: Salesforce objects extracted to S3 as JSON
   ```
   s3://raw-data-bucket/salesforce/Simpplr__Content__c/
   ```

2. **Step Functions Orchestration**: Triggers Glue jobs in rank order
   - Rank 200 jobs run in parallel
   - Rank 300 jobs wait for Rank 200 completion
   - etc.

3. **Glue Job Execution**:
   - Read JSON from S3
   - Load ID mappings from Zeus DB
   - Transform data
   - Validate
   - Write to Zeus DB
   - Update EMS status

4. **Output**:
   - Transformed data in Zeus DB
   - Processed data in S3 (Parquet) for audit
   - Error data in error bucket (if failures)

## Data Flow Example: Content Migration

```
AppFlow
  ↓
s3://raw-data-bucket/salesforce/Simpplr__Content__c/*.json
  ↓
Glue Job: cont-content
  ↓
1. Read JSON from S3
2. Lookup site_id from Simpplr__Site__c → Zeus sites table
3. Lookup created_by_user_id from User → Zeus users table
4. Sanitize HTML body
5. Generate new UUID
6. Map fields
  ↓
Zeus DB: content_mgmt.contents
```

## Testing

### Local Development

For local testing without Glue:

```python
# Set up local Spark session
from pyspark.sql import SparkSession

spark = SparkSession.builder \
    .appName("local-test") \
    .master("local[*]") \
    .getOrCreate()

# Read sample data
df = spark.read.json("test-data/Simpplr__Content__c.json")

# Test transformation
from cont_content.script import transform_content
result = transform_content(df, context, spark)
result.show()
```

### Glue Interactive Sessions

Use AWS Glue interactive sessions for testing:

```bash
%glue_version 4.0
%number_of_workers 5

# Test script
!aws s3 cp s3://scripts-bucket/glue-jobs/cont-content/script.py .
%run script.py
```

## Monitoring

### CloudWatch Logs

All logs are written to CloudWatch:

```
/aws-glue/jobs/output/{job-name}
/aws-glue/jobs/error/{job-name}
```

### Entity Migration Status (EMS)

Track progress in DynamoDB:

```python
{
  "tenant_id": "customer-001",
  "entity_name": "cont-content",
  "status": "completed",
  "records_processed": 15234,
  "started_at": "2025-01-15T10:00:00Z",
  "completed_at": "2025-01-15T10:15:00Z"
}
```

## Troubleshooting

### Common Issues

**Issue**: `Table already exists` error

**Solution**: Change write mode to `overwrite` or `append` in `write_to_zeus_db()`

---

**Issue**: `Foreign key constraint violation`

**Solution**: Check that dependent entities have been migrated first. Review rank ordering.

---

**Issue**: `Null ID in mapping cache`

**Solution**: Reload ID mappings after writing parent records:
```python
context._load_id_mappings()
```

---

**Issue**: `Out of memory`

**Solution**: Increase DPU allocation in Glue job configuration

## Performance Tuning

### Partitioning

For large datasets, partition S3 data by tenant:

```
s3://raw-data-bucket/salesforce/Simpplr__Content__c/tenant=customer-001/
```

### Caching

Cache frequently-accessed lookups:

```python
user_mapping_df.cache()
```

### Spark Configuration

Optimize Spark settings in Glue job:

```python
'--conf': [
  'spark.sql.adaptive.enabled=true',
  'spark.sql.adaptive.coalescePartitions.enabled=true',
  'spark.sql.shuffle.partitions=200',
  'spark.serializer=org.apache.spark.serializer.KryoSerializer'
]
```

## References

- [ETL_TRANSFORMATIONS.md](../../ETL_TRANSFORMATIONS.md) - Detailed transformation documentation
- [AWS Glue Documentation](https://docs.aws.amazon.com/glue/)
- [PySpark API Reference](https://spark.apache.org/docs/latest/api/python/)
