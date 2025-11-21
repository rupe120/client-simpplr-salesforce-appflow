"""
Glue ETL Job: cont-events
Events migration
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


def transform_cont_events(source_df, context, spark):
    """
    Transform Simpplr__Event__c records to Zeus DB format

    Source: Simpplr__Event__c
    Target: content_mgmt.events
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_contents_id = create_lookup_udf(context, "contents")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        lookup_content_id(col("Simpplr__Content__c")).alias("content_id"),
        col("Simpplr__Start_DateTime__c").cast("timestamp").alias("start_datetime"),
        col("Simpplr__End_DateTime__c").cast("timestamp").alias("end_datetime"),
        col("Simpplr__Location__c").alias("location"),
        coalesce_int("Simpplr__Max_Attendees__c", 0).alias("max_attendees"),
        col("Simpplr__Is_Virtual__c").alias("is_virtual"),
        col("Simpplr__Meeting_Link__c").alias("meeting_link"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-events",
        s3_source_path="salesforce/Simpplr__Event__c/",
        target_schema="content_mgmt",
        target_table="events",
        transform_fn=transform_cont_events
    )
