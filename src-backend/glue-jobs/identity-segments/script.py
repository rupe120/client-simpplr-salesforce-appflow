"""
Glue ETL Job: identity-segments
Audiences migration
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


def transform_identity_segments(source_df, context, spark):
    """
    Transform Simpplr__Audience__c records to Zeus DB format

    Source: Simpplr__Audience__c
    Target: identity_mgmt.audiences
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_segments_id = create_lookup_udf(context, "segments")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        lookup_segment_id(col("Simpplr__Segment__c")).alias("segment_id"),
        parse_json_field(col("Simpplr__Criteria__c")).alias("criteria"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="identity-segments",
        s3_source_path="salesforce/Simpplr__Audience__c/",
        target_schema="identity_mgmt",
        target_table="audiences",
        transform_fn=transform_identity_segments
    )
