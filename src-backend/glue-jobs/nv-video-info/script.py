"""
Glue ETL Job: nv-video-info
Video metadata migration
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


def transform_nv_video_info(source_df, context, spark):
    """
    Transform Simpplr__Video_Info__c records to Zeus DB format

    Source: Simpplr__Video_Info__c
    Target: content_mgmt.videos
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
        col("Simpplr__Title__c").alias("title"),
        col("Simpplr__Description__c").alias("description"),
        col("Simpplr__Kaltura_Entry_Id__c").alias("kaltura_entry_id"),
        coalesce_int("Simpplr__Duration__c", 0).alias("duration_seconds"),
        col("Simpplr__Thumbnail_URL__c").alias("thumbnail_url"),
        col("Simpplr__Video_URL__c").alias("video_url"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        coalesce_int("Simpplr__View_Count__c", 0).alias("view_count"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="nv-video-info",
        s3_source_path="salesforce/Simpplr__Video_Info__c/",
        target_schema="content_mgmt",
        target_table="videos",
        transform_fn=transform_nv_video_info
    )
