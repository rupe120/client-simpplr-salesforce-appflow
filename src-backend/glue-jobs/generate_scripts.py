"""
Script to generate all Glue ETL job scripts from templates
This ensures consistency and completeness across all entity migrations
"""

import os
from pathlib import Path

# Define all entity configurations
ENTITY_CONFIGURATIONS = {
    # Account & App Configuration
    "ps-app-default": {
        "source": "Simpplr__App_Default__c",
        "target_schema": "account_app",
        "target_table": "app_defaults",
        "description": "App default settings migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Simpplr__Default_Value__c").alias("default_value"),
        col("Simpplr__Feature_Name__c").alias("feature_name"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        """
    },
    "ps-segments": {
        "source": "Simpplr__Segment__c",
        "target_schema": "account_app",
        "target_table": "segments",
        "description": "Audience segments migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        parse_json_field(col("Simpplr__Criteria__c")).alias("criteria"),
        col("Simpplr__Segment_Type__c").alias("segment_type"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lookup_user_id(col("CreatedById")).alias("created_by"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        """,
        "lookups": ["users"]
    },

    # Identity
    "identity-people-categories": {
        "source": "Simpplr__People_Category__c",
        "target_schema": "identity_mgmt",
        "target_table": "people_categories",
        "description": "People categories migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Simpplr__Type__c").alias("category_type"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        """
    },
    "identity-segments": {
        "source": "Simpplr__Audience__c",
        "target_schema": "identity_mgmt",
        "target_table": "audiences",
        "description": "Audiences migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        lookup_segment_id(col("Simpplr__Segment__c")).alias("segment_id"),
        parse_json_field(col("Simpplr__Criteria__c")).alias("criteria"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        """,
        "lookups": ["segments"]
    },

    # Content
    "cont-sites": {
        "source": "Simpplr__Site__c",
        "target_schema": "content_mgmt",
        "target_table": "sites",
        "description": "Sites migration",
        "fields_mapping": """
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
        """
    },
    "cont-folders": {
        "source": "Simpplr__Folder__c",
        "target_schema": "content_mgmt",
        "target_table": "folders",
        "description": "Folder hierarchy migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        lookup_folder_id(col("Simpplr__Parent_Folder__c")).alias("parent_folder_id"),
        lookup_site_id(col("Simpplr__Site__c")).alias("site_id"),
        col("Simpplr__Path__c").alias("path"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        """,
        "lookups": ["folders", "sites"]
    },
    "cont-topics": {
        "source": "Simpplr__Topic__c",
        "target_schema": "content_mgmt",
        "target_table": "topics",
        "description": "Topics migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Description").alias("description"),
        lit(context.tenant_id).alias("tenant_id")
        """
    },
    "cont-events": {
        "source": "Simpplr__Event__c",
        "target_schema": "content_mgmt",
        "target_table": "events",
        "description": "Events migration",
        "fields_mapping": """
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
        """,
        "lookups": ["contents"]
    },
    "cont-likes": {
        "source": "Simpplr__Like__c",
        "target_schema": "content_mgmt",
        "target_table": "likes",
        "description": "Likes migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        lookup_user_id(col("Simpplr__User__c")).alias("user_id"),
        col("Simpplr__Entity_Type__c").alias("entity_type"),
        col("Simpplr__Entity_Id__c").alias("entity_id"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        lit(context.tenant_id).alias("tenant_id")
        """,
        "lookups": ["users"]
    },

    # Feed
    "feed-feed-posts": {
        "source": "Simpplr__Feed_Item__c",
        "target_schema": "content_mgmt",
        "target_table": "feed_items",
        "description": "Feed posts migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        sanitize_html(col("Simpplr__Body__c")).alias("body"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        col("Simpplr__Parent_Id__c").alias("parent_id"),
        col("Simpplr__Parent_Type__c").alias("parent_type"),
        col("Simpplr__Type__c").alias("feed_type"),
        col("Simpplr__Image_URL__c").alias("image_url"),
        col("Simpplr__Link_URL__c").alias("link_url"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        """,
        "lookups": ["users"],
        "filter": 'col("Simpplr__Is_Deleted__c") == False'
    },
    "feed-comments": {
        "source": "Simpplr__Feed_Item_Comment__c",
        "target_schema": "content_mgmt",
        "target_table": "feed_comments",
        "description": "Feed comments migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        lookup_feed_item_id(col("Simpplr__Feed_Item__c")).alias("feed_item_id"),
        sanitize_html(col("Simpplr__Comment_Text__c")).alias("comment_text"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        lit(context.tenant_id).alias("tenant_id")
        """,
        "lookups": ["feed_items", "users"]
    },
    "qna-question": {
        "source": "Simpplr__Question__c",
        "target_schema": "content_mgmt",
        "target_table": "questions",
        "description": "Q&A questions migration",
        "fields_mapping": """
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
        """,
        "lookups": ["users", "sites"]
    },
    "qna-answer": {
        "source": "Simpplr__Answer__c",
        "target_schema": "content_mgmt",
        "target_table": "answers",
        "description": "Q&A answers migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        lookup_question_id(col("Simpplr__Question__c")).alias("question_id"),
        sanitize_html(col("Simpplr__Answer_Text__c")).alias("answer_text"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        coalesce_int("Simpplr__Vote_Count__c", 0).alias("vote_count"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        lit(context.tenant_id).alias("tenant_id")
        """,
        "lookups": ["questions", "users"]
    },
    "qna-vote": {
        "source": "Simpplr__Vote__c",
        "target_schema": "content_mgmt",
        "target_table": "votes",
        "description": "Q&A votes migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        lookup_user_id(col("Simpplr__User__c")).alias("user_id"),
        lookup_answer_id(col("Simpplr__Answer__c")).alias("answer_id"),
        col("Simpplr__Vote_Type__c").alias("vote_type"),
        col("CreatedDate").cast("timestamp").alias("created_at"),
        lit(context.tenant_id).alias("tenant_id")
        """,
        "lookups": ["users", "answers"]
    },

    # Native Video
    "nv-category": {
        "source": "Simpplr__Category__c",
        "target_schema": "content_mgmt",
        "target_table": "video_categories",
        "description": "Video categories migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Simpplr__Description__c").alias("description"),
        col("Simpplr__Kaltura_Category_Id__c").alias("kaltura_category_id"),
        lookup_category_id(col("Simpplr__Parent_Category__c")).alias("parent_category_id"),
        col("Simpplr__Is_Active__c").alias("is_active"),
        lit(context.tenant_id).alias("tenant_id")
        """,
        "lookups": ["video_categories"]
    },
    "nv-video-info": {
        "source": "Simpplr__Video_Info__c",
        "target_schema": "content_mgmt",
        "target_table": "videos",
        "description": "Video metadata migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Simpplr__Title__c").alias("title"),
        col("Simpplr__Description__c").alias("description"),
        col("Simpplr__Kaltura_Entry_Id__c").alias("kaltura_entry_id"),
        coalesce_int("Simpplr__Duration__c", 0).alias("duration_seconds"),
        col("Simpplr__Thumbnail_URL__c").alias("thumbnail_url"),
        col("Simpplr__Video_URL__c").alias("video_url"),
        lookup_user_id(col("Simpplr__Created_By__c")).alias("created_by_user_id"),
        coalesce_int("Simpplr__View_Count__c", 0).alias("view_count"),
        lit(context.tenant_id).alias("tenant_id"),
        col("CreatedDate").cast("timestamp").alias("created_at")
        """,
        "lookups": ["users"]
    },
    "nv-permission-group": {
        "source": "Simpplr__Permission_Group__c",
        "target_schema": "content_mgmt",
        "target_table": "video_permission_groups",
        "description": "Video permission groups migration",
        "fields_mapping": """
        generate_uuid().alias("id"),
        col("Id").alias("external_id"),
        col("Name").alias("name"),
        col("Simpplr__Description__c").alias("description"),
        col("Simpplr__Group_Type__c").alias("group_type"),
        lit(context.tenant_id).alias("tenant_id")
        """
    },
}


def generate_script(entity_name, config):
    """Generate a Glue ETL script from configuration"""

    lookups = config.get("lookups", [])
    filter_condition = config.get("filter", "")

    lookup_defs = "\n    ".join([
        f'lookup_{entity}_id = create_lookup_udf(context, "{entity}")'
        for entity in lookups
    ])

    filter_clause = f".filter(\n        {filter_condition}\n    )" if filter_condition else ""

    script_template = f'''"""
Glue ETL Job: {entity_name}
{config['description']}
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


def transform_{entity_name.replace("-", "_")}(source_df, context, spark):
    """
    Transform {config['source']} records to Zeus DB format

    Source: {config['source']}
    Target: {config['target_schema']}.{config['target_table']}
    """
    # Register UDFs
    spark.udf.register("generate_uuid", generate_uuid)
    spark.udf.register("sanitize_html", sanitize_html)
    spark.udf.register("parse_json_field", parse_json_field)

    # Create lookup UDFs
    {lookup_defs}

    transformed_df = source_df{filter_clause}.select(
        {config['fields_mapping']}
    )

    return transformed_df


if __name__ == "__main__":
    run_etl_job(
        entity_name="{entity_name}",
        s3_source_path="salesforce/{config['source']}/",
        target_schema="{config['target_schema']}",
        target_table="{config['target_table']}",
        transform_fn=transform_{entity_name.replace("-", "_")}
    )
'''

    return script_template


def main():
    """Generate all Glue ETL scripts"""
    base_dir = Path(__file__).parent

    for entity_name, config in ENTITY_CONFIGURATIONS.items():
        entity_dir = base_dir / entity_name
        entity_dir.mkdir(exist_ok=True)

        script_content = generate_script(entity_name, config)
        script_path = entity_dir / "script.py"

        with open(script_path, 'w') as f:
            f.write(script_content)

        print(f"Generated: {script_path}")

    print(f"\nGenerated {len(ENTITY_CONFIGURATIONS)} Glue ETL scripts")


if __name__ == "__main__":
    main()
