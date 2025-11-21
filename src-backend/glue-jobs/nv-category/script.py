"""
Glue ETL Job: nv-category
Video categories migration
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


def transform_nv_category(source_df, context, spark):
    """
    Transform Simpplr__Category__c records to Zeus DB format

    Source: Simpplr__Category__c
    Target: content_mgmt.video_categories
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_video_categories_id = create_lookup_udf(context, "video_categories")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Simpplr__Description__c").alias("description"),
        col("Simpplr__Kaltura_Category_Id__c").alias("kaltura_category_id"),
        lookup_category_id(col("Simpplr__Parent_Category__c")).alias("parent_category_id"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="nv-category",
        s3_source_path="salesforce/Simpplr__Category__c/",
        target_schema="content_mgmt",
        target_table="video_categories",
        transform_fn=transform_nv_category
    )
