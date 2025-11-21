"""
Glue ETL Job: identity-expertise
Migrates People Expertise + Endorsements from Salesforce to Zeus DB
Creates records in both identity_mgmt.people_expertise and identity_mgmt.expertise_endorsements
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


def transform_expertise(source_df, context: GlueETLContext, spark):
    """
    Transform People Expertise + Endorsements to Zeus DB format

    Source: Simpplr__People_Expertise__c JOIN Simpplr__People_Expertise_Detail__c
    Target: identity_mgmt.people_expertise AND identity_mgmt.expertise_endorsements

    This transformation handles the join between expertise and endorsement records
    AppFlow extracts them separately, so we need to process them sequentially
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)

    # Create lookup UDFs
    lookup_user_id = create_lookup_udf(context, 'users')
    lookup_expertise_id = create_lookup_udf(context, 'people_expertise')

    # Source_df is People_Expertise__c
    expertise_df = source_df

    # Transform to people_expertise table
    expertise_transformed_df = expertise_df.filter(
        col("Simpplr__Is_Deleted__c") == False
    ).select(
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),

        # FK to users (person who has the expertise)
        lookup_user_id(col("Simpplr__User__c")).alias("user_id"),

        # Expertise fields
        col("Simpplr__Skill_Name__c").alias("skill_name"),
        col("Simpplr__Proficiency_Level__c").alias("proficiency_level"),
        col("Simpplr__Years_of_Experience__c").cast("integer").alias("years_of_experience"),
        col("Simpplr__Description__c").alias("description"),

        # Endorsement count
        when(col("Simpplr__Endorsement_Count__c").isNotNull(),
             col("Simpplr__Endorsement_Count__c")).otherwise(0).alias("endorsement_count"),

        # Metadata
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        col("LastModifiedDate").cast("timestamp").alias("updated_at")
    ).filter(
        # Only include expertise with valid skill names
        col("skill_name").isNotNull()
    )

    # Write expertise to Zeus DB FIRST
    context.write_to_zeus_db(expertise_transformed_df, "people_expertise", "identity_mgmt")

    # Reload ID mappings for endorsement FK lookup
    context._load_id_mappings()

    # Read Expertise Detail (endorsements) from S3
    s3_bucket = context.args['RAW_DATA_BUCKET']
    endorsements_s3_path = f"s3://{s3_bucket}/salesforce/Simpplr__People_Expertise_Detail__c/"

    try:
        endorsements_df = context.read_from_s3(endorsements_s3_path)

        # Transform to expertise_endorsements table
        endorsements_transformed_df = endorsements_df.filter(
            col("Simpplr__Is_Deleted__c") == False
        ).select(
            generate_uuid().alias("id"),
            col("Id").alias("external_id"),

            # FK to people_expertise (just-created)
            lookup_expertise_id(col("Simpplr__People_Expertise__c")).alias("expertise_id"),

            # FK to users (person who endorsed)
            lookup_user_id(col("Simpplr__Endorsed_By__c")).alias("endorsed_by_user_id"),

            # Endorsement fields
            col("Simpplr__Endorsement_Text__c").alias("endorsement_text"),
            col("Simpplr__Rating__c").cast("integer").alias("rating"),

            # Metadata
            lit(context.tenant_id).alias("tenant_id"),
            col("CreatedDate").cast("timestamp").alias("created_at")
        ).filter(
            # Only include endorsements with valid expertise FK
            col("expertise_id").isNotNull()
        )

        # Write endorsements to Zeus DB
        context.write_to_zeus_db(endorsements_transformed_df, "expertise_endorsements", "identity_mgmt")

    except Exception as e:
        # Endorsements table may not exist for some tenants
        context.logger.warning(f"No endorsements found: {e}")

    # Return expertise DataFrame for EMS record count
    return expertise_transformed_df


if __name__ == "__main__":
    # Note: This script writes to TWO tables: people_expertise and expertise_endorsements
    run_etl_job(
        entity_name="identity-expertise",
        s3_source_path="salesforce/Simpplr__People_Expertise__c/",
        target_schema="identity_mgmt",
        target_table="people_expertise",
        transform_fn=transform_expertise
    )
