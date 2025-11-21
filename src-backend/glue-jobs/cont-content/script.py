"""
Glue ETL Job: cont-content
Migrates Simpplr__Content__c from Salesforce to Zeus DB content_mgmt.contents
"""

import sys
from pyspark.sql.functions import col, lit, when
from pyspark.sql.types import StringType, IntegerType

sys.path.append('/gluelibs')
from base_script import run_etl_job
from glue_utils import (
    generate_uuid,
    create_lookup_udf,
    sanitize_html,
    coalesce_int
)


def transform_content(source_df, context, spark):
    """
    Transform Simpplr__Content__c records to Zeus DB format

    Source: Simpplr__Content__c
    Target: content_mgmt.contents
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)

    # Create lookup UDFs
    lookup_site_id = create_lookup_udf(context, 'sites')
    lookup_user_id = create_lookup_udf(context, 'users')

    transformed_df = source_df.filter(
        # Filter out soft-deleted records
        col("Simpplr__Is_Deleted__c") == False
    ).select(
        # Generate new Zeus UUID
        generate_uuid().alias("id"),

        # Map Salesforce ID to external_id
        col("Id").alias("external_id"),

        # Content fields
        col("Simpplr__Title__c").alias("title"),

        # Sanitize HTML body
        sanitize_html(col("Simpplr__Body__c")).alias("body"),

        # Content type (blog, event, album)
        col("Simpplr__Content_Type__c").alias("content_type"),

        # Foreign keys
        lookup_site_id(col("Simpplr__Site__c")).alias("site_id"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),

        # Publication fields
        col("Simpplr__Published_Date__c").cast("timestamp").alias("published_date"),
        col("Simpplr__Is_Published__c").alias("is_published"),

        # Counters with defaults
        coalesce_int("Simpplr__View_Count__c", 0).alias("view_count"),
        coalesce_int("Simpplr__Like_Count__c", 0).alias("like_count"),
        coalesce_int("Simpplr__Comment_Count__c", 0).alias("comment_count"),

        # Media
        col("Simpplr__Primary_Image_URL__c").alias("primary_image_url"),

        # Tenant and timestamps
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        col("LastModifiedDate").cast("timestamp").alias("updated_at")
    ).filter(
        # Validate content type
        col("content_type").isin("blog", "event", "album", "page")
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-content",
        s3_source_path="salesforce/Simpplr__Content__c/",
        target_schema="content_mgmt",
        target_table="contents",
        transform_fn=transform_content
    )
