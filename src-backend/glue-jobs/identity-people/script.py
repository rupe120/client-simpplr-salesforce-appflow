"""
Glue ETL Job: identity-people
Migrates User + Simpplr__People__c from Salesforce to Zeus DB
Creates records in both identity_mgmt.users and identity_mgmt.people
"""

import sys
from pyspark.sql.functions import col, lit, when
from pyspark.sql.types import StringType

sys.path.append('/gluelibs')
from base_script import run_etl_job
from glue_utils import (
    generate_uuid,
    create_lookup_udf,
    validate_email,
    GlueETLContext
)


def transform_people(source_df, context: GlueETLContext, spark):
    """
    Transform User + People__c records to Zeus DB format

    Source: User JOIN Simpplr__People__c
    Target: identity_mgmt.users AND identity_mgmt.people

    This transformation handles the join between User and People__c objects
    AppFlow extracts them separately, so we need to join them
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)

    # Create lookup UDFs
    lookup_profile_id = create_lookup_udf(context, 'profiles')
    lookup_user_id = create_lookup_udf(context, 'users')

    # Read User data from S3
    user_s3_path = f"s3://{context.args['RAW_DATA_BUCKET']}/salesforce/User/"
    user_df = context.read_from_s3(user_s3_path)

    # Read People data from S3 (source_df)
    people_df = source_df

    # Join User and People on User__c field
    joined_df = user_df.alias("u").join(
        people_df.alias("p"),
        col("u.Id") == col("p.Simpplr__User__c"),
        "inner"
    ).filter(
        # Only active users
        col("u.IsActive") == True
    )

    # Transform to users table
    users_df = joined_df.select(
        generate_uuid().alias("id"),
        col("u.Id").alias("external_id"),
        col("u.Email").alias("email"),
        col("u.FirstName").alias("first_name"),
        col("u.LastName").alias("last_name"),
        col("u.IsActive").alias("is_active"),
        lookup_profile_id(col("u.ProfileId")).alias("profile_id"),
        lit(context.tenant_id).alias("tenant_id"),
        col("u.CreatedDate").cast("timestamp").alias("created_at"),
        col("u.LastModifiedDate").cast("timestamp").alias("updated_at")
    ).filter(
        # Validate email
        validate_email("email")
    )

    # Write users to Zeus DB
    context.write_to_zeus_db(users_df, "users", "identity_mgmt")

    # Reload user mappings for people FK lookup
    context._load_id_mappings()

    # Transform to people table (extended profile)
    people_transformed_df = joined_df.select(
        generate_uuid().alias("id"),
        col("p.Id").alias("external_id"),

        # Lookup user_id from just-created users
        lookup_user_id(col("u.Id")).alias("user_id"),

        # Map people-specific fields
        col("p.Simpplr__Bio__c").alias("bio"),
        col("p.Simpplr__Location__c").alias("location"),
        col("p.Simpplr__Phone__c").alias("phone"),

        # Manager lookup (self-referential)
        lookup_user_id(col("p.Simpplr__Manager__c")).alias("manager_id"),

        col("p.Simpplr__Department__c").alias("department"),
        col("p.Simpplr__Job_Title__c").alias("job_title"),
        col("p.Simpplr__Profile_Image_URL__c").alias("profile_image_url"),
        col("p.Simpplr__Cover_Image_URL__c").alias("cover_image_url"),

        lit(context.tenant_id).alias("tenant_id"),
        col("p.CreatedDate").cast("timestamp").alias("created_at"),
        col("p.LastModifiedDate").cast("timestamp").alias("updated_at")
    )

    # Return people DataFrame for writing
    return people_transformed_df


if __name__ == "__main__":
    # Note: This script writes to TWO tables: users and people
    # The base script is modified to handle this
    run_etl_job(
        entity_name="identity-people",
        s3_source_path="salesforce/Simpplr__People__c/",
        target_schema="identity_mgmt",
        target_table="people",
        transform_fn=transform_people
    )
