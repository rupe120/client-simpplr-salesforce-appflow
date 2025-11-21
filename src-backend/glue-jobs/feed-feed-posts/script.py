"""
Glue ETL Job: feed-feed-posts
Feed posts migration
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


def transform_feed_feed_posts(source_df, context, spark):
    """
    Transform Simpplr__Feed_Item__c records to Zeus DB format

    Source: Simpplr__Feed_Item__c
    Target: content_mgmt.feed_items
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_users_id = create_lookup_udf(context, "users")

    transformed_df = source_df.filter(
        col("Simpplr__Is_Deleted__c") == False
    ).select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        sanitize_html(col("Simpplr__Body__c")).alias("body"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        col("Simpplr__Parent_Id__c").alias("parent_id"),
        col("Simpplr__Parent_Type__c").alias("parent_type"),
        col("Simpplr__Type__c").alias("feed_type"),
        col("Simpplr__Image_URL__c").alias("image_url"),
        col("Simpplr__Link_URL__c").alias("link_url"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="feed-feed-posts",
        s3_source_path="salesforce/Simpplr__Feed_Item__c/",
        target_schema="content_mgmt",
        target_table="feed_items",
        transform_fn=transform_feed_feed_posts
    )
