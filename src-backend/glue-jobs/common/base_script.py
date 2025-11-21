"""
Base template for Glue ETL scripts
All entity-specific scripts inherit from this pattern
"""

import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from pyspark.sql.functions import col, lit, when
import logging

# Import common utilities
sys.path.append('/gluelibs')
from glue_utils import (
    GlueETLContext,
    generate_uuid,
    sanitize_html,
    parse_json_field,
    create_lookup_udf,
    validate_email,
    coalesce_int,
    coalesce_bool
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_etl_job(
    entity_name: str,
    s3_source_path: str,
    target_schema: str,
    target_table: str,
    transform_fn
):
    """
    Run ETL job with standard pattern

    Args:
        entity_name: Name of the entity being migrated
        s3_source_path: S3 path to source data (AppFlow output)
        target_schema: Target Zeus DB schema
        target_table: Target Zeus DB table
        transform_fn: Function to transform the data
    """
    # Get job arguments
    args = getResolvedOptions(sys.argv, [
        'JOB_NAME',
        'ENTITY_NAME',
        'TENANT_ID',
        'ZEUS_DB_SECRET_ARN',
        'RAW_DATA_BUCKET',
        'PROCESSED_DATA_BUCKET',
        'ERROR_DATA_BUCKET',
        'EMS_TABLE_NAME',
        'TMS_TABLE_NAME'
    ])

    # Optional arguments
    try:
        cdc_args = getResolvedOptions(sys.argv, ['CDC_DB_SECRET_ARN'])
        args.update(cdc_args)
    except:
        pass

    # Initialize Spark and Glue contexts
    sc = SparkContext()
    glueContext = GlueContext(sc)
    spark = glueContext.spark_session
    job = Job(glueContext)
    job.init(args['JOB_NAME'], args)

    try:
        # Initialize ETL context
        context = GlueETLContext(spark, args)
        context.initialize()

        # Update EMS status to 'in_progress'
        context.update_ems_status('in_progress')

        # Step 1: Extract from S3
        logger.info(f"Extracting data for {entity_name}")
        s3_path = f"s3://{args['RAW_DATA_BUCKET']}/{s3_source_path}"
        source_df = context.read_from_s3(s3_path)

        logger.info(f"Extracted {source_df.count()} records")

        # Step 2: Transform
        logger.info(f"Transforming data for {entity_name}")
        transformed_df = transform_fn(source_df, context, spark)

        logger.info(f"Transformed {transformed_df.count()} records")

        # Step 3: Validate
        logger.info("Validating transformed data")
        validated_df = transformed_df.filter(col('id').isNotNull())

        # Log validation failures
        failed_count = transformed_df.count() - validated_df.count()
        if failed_count > 0:
            logger.warning(f"{failed_count} records failed validation")

        # Step 4: Load to Zeus DB
        logger.info(f"Loading data to {target_schema}.{target_table}")
        context.write_to_zeus_db(
            validated_df,
            target_table,
            target_schema,
            mode='append'
        )

        # Step 5: Write processed data to S3 for audit
        processed_path = f"s3://{args['PROCESSED_DATA_BUCKET']}/{entity_name}/"
        validated_df.write.mode('overwrite').parquet(processed_path)

        # Update EMS status to 'completed'
        context.update_ems_status('completed')

        logger.info(f"ETL job completed successfully for {entity_name}")

    except Exception as e:
        logger.error(f"ETL job failed: {str(e)}", exc_info=True)

        # Update EMS status to 'failed'
        context.update_ems_status('failed', str(e))

        # Write error records to error bucket
        try:
            error_path = f"s3://{args['ERROR_DATA_BUCKET']}/{entity_name}/"
            source_df.write.mode('overwrite').json(error_path)
        except:
            pass

        raise

    finally:
        job.commit()


if __name__ == "__main__":
    # This is a template - actual scripts will import and use run_etl_job
    pass
