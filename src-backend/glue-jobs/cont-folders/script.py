"""
Glue ETL Job: cont-folders
Folder hierarchy migration
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


def transform_cont_folders(source_df, context, spark):
    """
    Transform Simpplr__Folder__c records to Zeus DB format

    Source: Simpplr__Folder__c
    Target: content_mgmt.folders
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_folders_id = create_lookup_udf(context, "folders")
    lookup_sites_id = create_lookup_udf(context, "sites")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        lookup_folder_id(col("Simpplr__Parent_Folder__c")).alias("parent_folder_id"),
        lookup_site_id(col("Simpplr__Site__c")).alias("site_id"),
        col("Simpplr__Path__c").alias("path"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-folders",
        s3_source_path="salesforce/Simpplr__Folder__c/",
        target_schema="content_mgmt",
        target_table="folders",
        transform_fn=transform_cont_folders
    )
