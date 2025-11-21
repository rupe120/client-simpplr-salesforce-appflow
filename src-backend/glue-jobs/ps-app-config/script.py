"""
Glue ETL Job: ps-app-config
Migrates Simpplr__App_Config__c from Salesforce to Zeus DB account_app.app_configs
"""

import sys
from pyspark.sql.functions import col, lit, udf
from pyspark.sql.types import StringType

sys.path.append('/gluelibs')
from base_script import run_etl_job
from glue_utils import generate_uuid, parse_json_field


def transform_app_config(source_df, context, spark):
    """
    Transform Salesforce App_Config__c records to Zeus DB format

    Source: Simpplr__App_Config__c
    Target: account_app.app_configs
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("parse_json_field", parse_json_field)

    transformed_df = source_df.filter(
        # Filter out soft-deleted records
        col("Simpplr__Is_Deleted__c") == False
    ).select(
        # Generate new Zeus UUID
        generate_uuid().alias("id"),

        # Map Salesforce ID to external_id
        col("Id").alias("external_id"),

        # Map fields
        col("Name").alias("name"),

        # Parse JSON settings field
        parse_json_field(col("Simpplr__Settings__c")).alias("settings"),

        # Map type
        col("Simpplr__Type__c").alias("type"),

        # Add tenant ID from context
        lit(context.tenant_id).alias("tenant_id"),

        # Map timestamps
        col("CreatedDate").cast("timestamp").alias("created_at"),
        col("LastModifiedDate").cast("timestamp").alias("updated_at"),

        # Set is_deleted to false (we filtered deleted records)
        lit(False).alias("is_deleted")
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="ps-app-config",
        s3_source_path="salesforce/Simpplr__App_Config__c/",
        target_schema="account_app",
        target_table="app_configs",
        transform_fn=transform_app_config
    )
