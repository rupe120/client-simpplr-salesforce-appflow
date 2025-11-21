"""
Glue ETL Job: identity-people-categories
People categories migration
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


def transform_identity_people_categories(source_df, context, spark):
    """
    Transform Simpplr__People_Category__c records to Zeus DB format

    Source: Simpplr__People_Category__c
    Target: identity_mgmt.people_categories
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Simpplr__Type__c").alias("category_type"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="identity-people-categories",
        s3_source_path="salesforce/Simpplr__People_Category__c/",
        target_schema="identity_mgmt",
        target_table="people_categories",
        transform_fn=transform_identity_people_categories
    )
