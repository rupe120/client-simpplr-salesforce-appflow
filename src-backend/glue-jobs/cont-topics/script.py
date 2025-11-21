"""
Glue ETL Job: cont-topics
Topics migration
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


def transform_cont_topics(source_df, context, spark):
    """
    Transform Simpplr__Topic__c records to Zeus DB format

    Source: Simpplr__Topic__c
    Target: content_mgmt.topics
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
        col("Description").alias("description"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-topics",
        s3_source_path="salesforce/Simpplr__Topic__c/",
        target_schema="content_mgmt",
        target_table="topics",
        transform_fn=transform_cont_topics
    )
