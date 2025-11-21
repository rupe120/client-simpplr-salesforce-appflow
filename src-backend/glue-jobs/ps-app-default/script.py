"""
Glue ETL Job: ps-app-default
App default settings migration
"""

import sys
from pyspark.sql.functions import col, lit, when

sys.path.append('/gluelibs')
from base_script import run_etl_job
from glue_utils import (
    generate_uuid,
    create_lookup_udf,
    sanitize_html,
    parse_json_field,
    coalesce_int,
    coalesce_bool
)


def transform_ps_app_default(source_df, context, spark):
    """
    Transform Simpplr__App_Default__c records to Zeus DB format

    Source: Simpplr__App_Default__c
    Target: account_app.app_defaults
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Simpplr__Default_Value__c").alias("default_value"),
        col("Simpplr__Feature_Name__c").alias("feature_name"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="ps-app-default",
        s3_source_path="salesforce/Simpplr__App_Default__c/",
        target_schema="account_app",
        target_table="app_defaults",
        transform_fn=transform_ps_app_default
    )
