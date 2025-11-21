"""
Glue ETL Job: cont-likes
Likes migration
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


def transform_cont_likes(source_df, context, spark):
    """
    Transform Simpplr__Like__c records to Zeus DB format

    Source: Simpplr__Like__c
    Target: content_mgmt.likes
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_users_id = create_lookup_udf(context, "users")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        lookup_user_id(col("Simpplr__User__c")).alias("user_id"),
        col("Simpplr__Entity_Type__c").alias("entity_type"),
        col("Simpplr__Entity_Id__c").alias("entity_id"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-likes",
        s3_source_path="salesforce/Simpplr__Like__c/",
        target_schema="content_mgmt",
        target_table="likes",
        transform_fn=transform_cont_likes
    )
