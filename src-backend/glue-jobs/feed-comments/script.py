"""
Glue ETL Job: feed-comments
Feed comments migration
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


def transform_feed_comments(source_df, context, spark):
    """
    Transform Simpplr__Feed_Item_Comment__c records to Zeus DB format

    Source: Simpplr__Feed_Item_Comment__c
    Target: content_mgmt.feed_comments
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_feed_items_id = create_lookup_udf(context, "feed_items")
    lookup_users_id = create_lookup_udf(context, "users")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        lookup_feed_item_id(col("Simpplr__Feed_Item__c")).alias("feed_item_id"),
        sanitize_html(col("Simpplr__Comment_Text__c")).alias("comment_text"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="feed-comments",
        s3_source_path="salesforce/Simpplr__Feed_Item_Comment__c/",
        target_schema="content_mgmt",
        target_table="feed_comments",
        transform_fn=transform_feed_comments
    )
