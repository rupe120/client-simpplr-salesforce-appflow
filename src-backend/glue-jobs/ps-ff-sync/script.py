"""
Glue ETL Job: ps-ff-sync
Migrates LMA Feature Flags from Salesforce to Zeus DB
Aggregates multiple LMA tables (License, Feature Parameters) into normalized feature_flags table
"""

import sys
from pyspark.sql.functions import col, lit, explode, array, struct, when
from pyspark.sql.types import StringType

sys.path.append('/gluelibs')
from base_script import run_etl_job
from glue_utils import generate_uuid, GlueETLContext


def transform_feature_flags(source_df, context: GlueETLContext, spark):
    """
    Transform LMA License + Feature Parameters to Zeus DB format

    This is a complex transformation that:
    1. Reads License records
    2. Joins with 3 feature parameter tables (booleans, dates, integers)
    3. Normalizes into key-value pairs
    4. Writes to single feature_flags table

    Source: sfLma__License__c + sfFma__Feature_Parameter_*
    Target: account_app.feature_flags
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)

    # Read License data (source_df is licenses)
    license_df = source_df

    # Read Feature Parameter tables from S3
    s3_bucket = context.args['RAW_DATA_BUCKET']

    # Read Boolean feature parameters
    bool_s3_path = f"s3://{s3_bucket}/salesforce/sfFma__Feature_Parameter_Booleans__r/"
    try:
        bool_df = context.read_from_s3(bool_s3_path).select(
            col("sfLma__License__c").alias("license_id"),
            col("sfFma__Name__c").alias("feature_name"),
            col("sfFma__Value__c").cast("string").alias("feature_value"),
            lit("boolean").alias("feature_type")
        )
    except:
        # Table may not exist
        bool_df = spark.createDataFrame([], schema="license_id STRING, feature_name STRING, feature_value STRING, feature_type STRING")

    # Read Date feature parameters
    date_s3_path = f"s3://{s3_bucket}/salesforce/sfFma__Feature_Parameter_Dates__r/"
    try:
        date_df = context.read_from_s3(date_s3_path).select(
            col("sfLma__License__c").alias("license_id"),
            col("sfFma__Name__c").alias("feature_name"),
            col("sfFma__Value__c").cast("string").alias("feature_value"),
            lit("date").alias("feature_type")
        )
    except:
        date_df = spark.createDataFrame([], schema="license_id STRING, feature_name STRING, feature_value STRING, feature_type STRING")

    # Read Integer feature parameters
    int_s3_path = f"s3://{s3_bucket}/salesforce/sfFma__Feature_Parameter_Integers__r/"
    try:
        int_df = context.read_from_s3(int_s3_path).select(
            col("sfLma__License__c").alias("license_id"),
            col("sfFma__Name__c").alias("feature_name"),
            col("sfFma__Value__c").cast("string").alias("feature_value"),
            lit("integer").alias("feature_type")
        )
    except:
        int_df = spark.createDataFrame([], schema="license_id STRING, feature_name STRING, feature_value STRING, feature_type STRING")

    # Union all feature parameters
    all_features_df = bool_df.union(date_df).union(int_df)

    # Join with License to get package info
    features_with_license_df = all_features_df.join(
        license_df.select(
            col("Id").alias("license_id"),
            col("sfLma__Package__c").alias("package_name")
        ),
        "license_id",
        "inner"
    )

    # Transform to feature_flags table format
    transformed_df = features_with_license_df.select(
        generate_uuid().alias("id"),
        col("license_id").alias("external_id"),
        col("feature_name"),
        col("feature_value"),
        col("feature_type"),
        col("package_name"),
        lit(context.tenant_id).alias("tenant_id"),
        lit("LMA").alias("source")
    ).filter(
        # Only include features with valid names
        col("feature_name").isNotNull()
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="ps-ff-sync",
        s3_source_path="salesforce/sfLma__License__c/",
        target_schema="account_app",
        target_table="feature_flags",
        transform_fn=transform_feature_flags
    )
