"""
Glue ETL Job: cont-sites
Sites migration
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


def transform_cont_sites(source_df, context, spark):
    """
    Transform Simpplr__Site__c records to Zeus DB format

    Source: Simpplr__Site__c
    Target: content_mgmt.sites
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
        col("Simpplr__Title__c").alias("title"),
        col("Simpplr__Description__c").alias("description"),
        col("Simpplr__Site_Type__c").alias("site_type"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        col("Simpplr__Landing_Page__c").alias("landing_page"),
        col("Simpplr__Logo_URL__c").alias("logo_url"),
        col("Simpplr__Cover_Image_URL__c").alias("cover_image_url"),
        coalesce_int("Simpplr__Member_Count__c", 0).alias("member_count"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-sites",
        s3_source_path="salesforce/Simpplr__Site__c/",
        target_schema="content_mgmt",
        target_table="sites",
        transform_fn=transform_cont_sites
    )
