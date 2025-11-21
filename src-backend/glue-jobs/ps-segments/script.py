"""
Glue ETL Job: ps-segments
Audience segments migration
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


def transform_ps_segments(source_df, context, spark):
    """
    Transform Simpplr__Segment__c records to Zeus DB format

    Source: Simpplr__Segment__c
    Target: account_app.segments
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_users_id = create_lookup_udf(context, "users")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        parse_json_field(col("Simpplr__Criteria__c")).alias("criteria"),
        col("Simpplr__Segment_Type__c").alias("segment_type"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lookup_user_id(col("CreatedById")).alias("created_by"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="ps-segments",
        s3_source_path="salesforce/Simpplr__Segment__c/",
        target_schema="account_app",
        target_table="segments",
        transform_fn=transform_ps_segments
    )
