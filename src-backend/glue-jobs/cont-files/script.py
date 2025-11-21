"""
Glue ETL Job: cont-files
Migrates ContentDocument + ContentVersion from Salesforce to Zeus DB
Joins standard Salesforce file objects to extract file metadata
"""

import sys
from pyspark.sql.functions import col, lit, when, row_number
from pyspark.sql.window import Window
from pyspark.sql.types import StringType

sys.path.append('/gluelibs')
from base_script import run_etl_job
from glue_utils import (
    generate_uuid,
    create_lookup_udf,
    coalesce_int,
    GlueETLContext
)


def transform_files(source_df, context: GlueETLContext, spark):
    """
    Transform ContentDocument + ContentVersion to Zeus DB format

    Source: ContentDocument JOIN ContentVersion
    Target: content_mgmt.files

    ContentDocument: File container record
    ContentVersion: Specific version of the file (multiple versions possible)

    We join these to get the latest version of each file
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)

    # Create lookup UDFs
    lookup_user_id = create_lookup_udf(context, 'users')
    lookup_folder_id = create_lookup_udf(context, 'folders')

    # Read ContentDocument (source_df)
    content_doc_df = source_df

    # Read ContentVersion from S3
    s3_bucket = context.args['RAW_DATA_BUCKET']
    content_version_s3_path = f"s3://{s3_bucket}/salesforce/ContentVersion/"
    content_version_df = context.read_from_s3(content_version_s3_path)

    # Get latest version for each ContentDocument
    # Use window function to rank versions by VersionNumber descending
    window_spec = Window.partitionBy("ContentDocumentId").orderBy(col("VersionNumber").desc())

    latest_version_df = content_version_df.withColumn(
        "version_rank",
        row_number().over(window_spec)
    ).filter(
        col("version_rank") == 1  # Only keep latest version
    )

    # Join ContentDocument with latest ContentVersion
    joined_df = content_doc_df.alias("cd").join(
        latest_version_df.alias("cv"),
        col("cd.Id") == col("cv.ContentDocumentId"),
        "inner"
    ).filter(
        # Filter out deleted documents
        col("cd.IsDeleted") == False
    )

    # Read ContentDocumentLink to get parent folder/site context
    content_doc_link_s3_path = f"s3://{s3_bucket}/salesforce/ContentDocumentLink/"

    try:
        content_doc_link_df = context.read_from_s3(content_doc_link_s3_path)

        # Filter for links to Simpplr folders (LinkedEntityId starts with folder prefix)
        # We'll do a left join since not all files are in folders
        joined_df = joined_df.alias("files").join(
            content_doc_link_df.alias("cdl").filter(
                col("cdl.IsDeleted") == False
            ).select(
                col("cdl.ContentDocumentId"),
                col("cdl.LinkedEntityId").alias("parent_id")
            ),
            col("files.cd.Id") == col("cdl.ContentDocumentId"),
            "left_outer"
        )

        has_links = True
    except Exception as e:
        context.logger.warning(f"ContentDocumentLink not found: {e}")
        has_links = False

    # Transform to files table
    select_fields = [
        generate_uuid().alias("id"),
        col("cd.Id").alias("external_id"),

        # File metadata
        col("cv.Title").alias("title"),
        col("cv.Description").alias("description"),
        col("cv.FileExtension").alias("file_extension"),
        col("cv.ContentSize").cast("bigint").alias("file_size"),
        col("cv.VersionNumber").alias("version_number"),

        # File type and MIME
        col("cv.FileType").alias("file_type"),
        col("cv.ContentModifiedDate").cast("timestamp").alias("content_modified_date"),

        # S3 or external URL (if migrated)
        col("cv.ContentUrl").alias("content_url"),
        col("cv.PathOnClient").alias("original_path"),

        # Owner
        lookup_user_id(col("cv.OwnerId")).alias("owner_user_id"),

        # Metadata
        lit(context.tenant_id).alias("tenant_id"),
        col("cd.CreatedDate").cast("timestamp").alias("created_at"),
        col("cv.LastModifiedDate").cast("timestamp").alias("updated_at")
    ]

    # Add folder_id if we have links
    if has_links:
        select_fields.insert(10, lookup_folder_id(col("parent_id")).alias("folder_id"))
    else:
        select_fields.insert(10, lit(None).cast(StringType()).alias("folder_id"))

    transformed_df = joined_df.select(*select_fields).filter(
        # Only include files with valid extensions
        col("file_extension").isNotNull()
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="cont-files",
        s3_source_path="salesforce/ContentDocument/",
        target_schema="content_mgmt",
        target_table="files",
        transform_fn=transform_files
    )
