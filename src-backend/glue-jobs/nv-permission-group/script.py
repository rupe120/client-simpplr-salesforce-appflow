"""
Glue ETL Job: nv-permission-group
Video permission groups migration
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


def transform_nv_permission_group(source_df, context, spark):
    """
    Transform Simpplr__Permission_Group__c records to Zeus DB format

    Source: Simpplr__Permission_Group__c
    Target: content_mgmt.video_permission_groups
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
        col("Simpplr__Description__c").alias("description"),
        col("Simpplr__Group_Type__c").alias("group_type"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="nv-permission-group",
        s3_source_path="salesforce/Simpplr__Permission_Group__c/",
        target_schema="content_mgmt",
        target_table="video_permission_groups",
        transform_fn=transform_nv_permission_group
    )
