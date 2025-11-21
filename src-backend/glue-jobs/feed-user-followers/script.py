"""
Glue ETL Job: feed-user-followers
Migrates user follower relationships from Simpplr__Subscription__c
Filters subscriptions where entity_type = 'User' to derive follower graph
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


def transform_user_followers(source_df, context: GlueETLContext, spark):
    """
    Transform Simpplr__Subscription__c to user follower relationships

    Source: Simpplr__Subscription__c (where entity_type = 'User')
    Target: content_mgmt.user_followers

    Subscription model uses polymorphic relationship:
    - Simpplr__Entity_Type__c = 'User' means following a user
    - Simpplr__Entity_Id__c = Salesforce User ID being followed
    - Simpplr__Subscriber__c = Salesforce User ID of follower

    Result: follower_user_id follows followed_user_id
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)

    # Create lookup UDFs
    lookup_user_id = create_lookup_udf(context, 'users')

    # Filter subscriptions for user-follows-user relationships
    user_subscriptions_df = source_df.filter(
        (col("Simpplr__Is_Deleted__c") == False) &
        (col("Simpplr__Entity_Type__c") == "User") &
        (col("Simpplr__Is_Active__c") == True)
    )

    # Transform to user_followers table
    transformed_df = user_subscriptions_df.select(
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),

        # Follower (person doing the following)
        lookup_user_id(col("Simpplr__Subscriber__c")).alias("follower_user_id"),

        # Followed (person being followed)
        lookup_user_id(col("Simpplr__Entity_Id__c")).alias("followed_user_id"),

        # Subscription metadata
        col("Simpplr__Notification_Enabled__c").alias("notifications_enabled"),

        # Metadata
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
    ).filter(
        # Validate both user IDs exist
        (col("follower_user_id").isNotNull()) &
        (col("followed_user_id").isNotNull()) &
        # Prevent self-following
        (col("follower_user_id") != col("followed_user_id"))
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="feed-user-followers",
        s3_source_path="salesforce/Simpplr__Subscription__c/",
        target_schema="content_mgmt",
        target_table="user_followers",
        transform_fn=transform_user_followers
    )
