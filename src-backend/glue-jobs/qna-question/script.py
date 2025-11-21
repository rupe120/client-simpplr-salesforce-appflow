"""
Glue ETL Job: qna-question
Q&A questions migration
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


def transform_qna_question(source_df, context, spark):
    """
    Transform Simpplr__Question__c records to Zeus DB format

    Source: Simpplr__Question__c
    Target: content_mgmt.questions
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    lookup_users_id = create_lookup_udf(context, "users")
    lookup_sites_id = create_lookup_udf(context, "sites")

    transformed_df = source_df.select(
        
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Simpplr__Question_Text__c").alias("question_text"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        lookup_site_id(col("Simpplr__Site__c")).alias("site_id"),
        col("Simpplr__Is_Answered__c").alias("is_answered"),
        lit(None).alias("best_answer_id"),
        coalesce_int("Simpplr__View_Count__c", 0).alias("view_count"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        lit(context.tenant_id).alias("tenant_id")
        
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="qna-question",
        s3_source_path="salesforce/Simpplr__Question__c/",
        target_schema="content_mgmt",
        target_table="questions",
        transform_fn=transform_qna_question
    )
