"""
Glue ETL Job: cont-subscriptions
Migrates Simpplr__Subscription__c from Salesforce to Zeus DB
Handles polymorphic entity relationships (sites, content, topics, users)
"""

import sys
from pyspark.sql.functions import col, lit, when
from pyspark.sql.types import StringType

sys.path.append('/gluelibs')
from base_script import run_etl_job
from glue_utils import (
    generate_uuid,
    create_lookup_udf,
    GlueETLContext
)


def transform_subscriptions(source_df, context: GlueETLContext, spark):
    """
    Transform Simpplr__Subscription__c to Zeus DB format

    Source: Simpplr__Subscription__c
    Target: content_mgmt.subscriptions

    Polymorphic Relationship Pattern:
    - Simpplr__Entity_Type__c: 'Site', 'Content', 'Topic', 'User'
    - Simpplr__Entity_Id__c: Salesforce ID of the entity
    - We resolve this to the appropriate Zeus UUID based on entity_type
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)

    # Create lookup UDFs for different entity types
    lookup_user_id = create_lookup_udf(context, 'users')
    lookup_site_id = create_lookup_udf(context, 'sites')
    lookup_content_id = create_lookup_udf(context, 'contents')
    lookup_topic_id = create_lookup_udf(context, 'topics')

    # Filter active, non-deleted subscriptions
    subscriptions_df = source_df.filter(
        (col("Simpplr__Is_Deleted__c") == False) &
        (col("Simpplr__Is_Active__c") == True)
    )

    # Transform to subscriptions table with polymorphic lookup
    transformed_df = subscriptions_df.select(
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),

        # Subscriber (person subscribing)
        lookup_user_id(col("Simpplr__Subscriber__c")).alias("subscriber_user_id"),

        # Entity type (what they're subscribing to)
        col("Simpplr__Entity_Type__c").alias("entity_type"),

        # Polymorphic entity_id resolution
        # Use CASE statement to lookup correct ID based on entity_type
        when(col("Simpplr__Entity_Type__c") == "Site",
             lookup_site_id(col("Simpplr__Entity_Id__c")))
        .when(col("Simpplr__Entity_Type__c") == "Content",
              lookup_content_id(col("Simpplr__Entity_Id__c")))
        .when(col("Simpplr__Entity_Type__c") == "Topic",
              lookup_topic_id(col("Simpplr__Entity_Id__c")))
        .when(col("Simpplr__Entity_Type__c") == "User",
              lookup_user_id(col("Simpplr__Entity_Id__c")))
        .otherwise(None)
        .alias("entity_id"),

        # Subscription preferences
        col("Simpplr__Notification_Enabled__c").alias("notifications_enabled"),
        col("Simpplr__Email_Digest__c").alias("email_digest_enabled"),
        col("Simpplr__Frequency__c").alias("notification_frequency"),

        # Metadata
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        col("LastModifiedDate").cast("timestamp").alias("updated_at")
    ).filter(
        # Validate subscriber and entity IDs exist
        (col("subscriber_user_id").isNotNull()) &
        (col("entity_id").isNotNull()) &
        # Validate entity_type is one of the known types
        col("entity_type").isin("Site", "Content", "Topic", "User")
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-subscriptions",
        s3_source_path="salesforce/Simpplr__Subscription__c/",
        target_schema="content_mgmt",
        target_table="subscriptions",
        transform_fn=transform_subscriptions
    )
