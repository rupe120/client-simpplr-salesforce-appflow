"""
Common utilities for AWS Glue ETL jobs
Provides database connections, ID mapping, and transformation helpers
"""

import boto3
import json
import uuid
from typing import Dict, Any, Optional
from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import udf, col, when, lit
from pyspark.sql.types import StringType, BooleanType, IntegerType, DoubleType, TimestampType
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class GlueETLContext:
    """
    Context manager for Glue ETL jobs
    Handles database connections, ID mappings, and common operations
    """

    def __init__(self, spark: SparkSession, args: Dict[str, Any]):
        self.spark = spark
        self.args = args
        self.entity_name = args['ENTITY_NAME']
        self.tenant_id = args.get('TENANT_ID', 'default')
        self.zeus_db_creds = None
        self.cdc_db_creds = None
        self.id_mapping_cache = {}

    def initialize(self):
        """Initialize database connections and load ID mappings"""
        logger.info(f"Initializing ETL context for entity: {self.entity_name}")

        # Load database credentials
        self.zeus_db_creds = self._get_secret(self.args['ZEUS_DB_SECRET_ARN'])
        if 'CDC_DB_SECRET_ARN' in self.args:
            self.cdc_db_creds = self._get_secret(self.args['CDC_DB_SECRET_ARN'])

        # Load ID mappings for lookups
        self._load_id_mappings()

        logger.info("ETL context initialized successfully")

    def _get_secret(self, secret_arn: str) -> Dict[str, Any]:
        """Retrieve database credentials from AWS Secrets Manager"""
        client = boto3.client('secretsmanager')
        response = client.get_secret_value(SecretId=secret_arn)
        secret = json.loads(response['SecretString'])

        # Build JDBC URL
        secret['jdbc_url'] = (
            f"jdbc:postgresql://{secret['host']}:{secret['port']}/{secret['database']}"
        )
        return secret

    def _load_id_mappings(self):
        """
        Load ID mappings from Zeus DB for foreign key lookups
        Caches Salesforce ID → Zeus UUID mappings
        """
        logger.info("Loading ID mappings from Zeus DB")

        # Load mappings for common entities
        entities_to_map = [
            ('users', 'identity_mgmt'),
            ('people', 'identity_mgmt'),
            ('profiles', 'identity_mgmt'),
            ('sites', 'content_mgmt'),
            ('segments', 'account_app'),
            ('audiences', 'identity_mgmt'),
            ('folders', 'content_mgmt'),
            ('contents', 'content_mgmt'),
            ('feed_items', 'content_mgmt'),
        ]

        for table, schema in entities_to_map:
            try:
                df = self.spark.read.jdbc(
                    url=self.zeus_db_creds['jdbc_url'],
                    table=f"{schema}.{table}",
                    properties={
                        "user": self.zeus_db_creds['username'],
                        "password": self.zeus_db_creds['password'],
                        "driver": "org.postgresql.Driver"
                    }
                ).select("id", "external_id", "tenant_id")

                # Filter by tenant and create mapping
                mappings = df.filter(col("tenant_id") == self.tenant_id) \
                    .select("external_id", "id") \
                    .collect()

                self.id_mapping_cache[table] = {
                    row.external_id: row.id for row in mappings
                }

                logger.info(f"Loaded {len(mappings)} mappings for {table}")
            except Exception as e:
                logger.warning(f"Could not load mappings for {table}: {e}")
                self.id_mapping_cache[table] = {}

    def lookup_id(self, entity_type: str, external_id: Optional[str]) -> Optional[str]:
        """
        Lookup Zeus UUID for a Salesforce external ID

        Args:
            entity_type: Type of entity (users, sites, etc.)
            external_id: Salesforce ID

        Returns:
            Zeus UUID or None if not found
        """
        if not external_id:
            return None

        cache = self.id_mapping_cache.get(entity_type, {})
        return cache.get(external_id)

    def read_from_s3(self, s3_path: str) -> DataFrame:
        """Read JSON data from S3 (AppFlow output)"""
        logger.info(f"Reading data from S3: {s3_path}")
        return self.spark.read.json(s3_path)

    def write_to_zeus_db(self, df: DataFrame, table: str, schema: str, mode: str = 'append'):
        """Write DataFrame to Zeus DB"""
        logger.info(f"Writing {df.count()} rows to {schema}.{table}")

        df.write.jdbc(
            url=self.zeus_db_creds['jdbc_url'],
            table=f"{schema}.{table}",
            mode=mode,
            properties={
                "user": self.zeus_db_creds['username'],
                "password": self.zeus_db_creds['password'],
                "driver": "org.postgresql.Driver"
            }
        )

        logger.info(f"Successfully wrote to {schema}.{table}")

    def update_ems_status(self, status: str, error_message: Optional[str] = None):
        """Update Entity Migration Status in DynamoDB"""
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(self.args['EMS_TABLE_NAME'])

        update_expr = "SET #status = :status, updated_at = :timestamp"
        expr_attr_names = {"#status": "status"}
        expr_attr_values = {
            ":status": status,
            ":timestamp": str(int(time.time()))
        }

        if error_message:
            update_expr += ", error_message = :error"
            expr_attr_values[":error"] = error_message

        table.update_item(
            Key={
                'tenant_id': self.tenant_id,
                'entity_name': self.entity_name
            },
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values
        )


# UDF Definitions

@udf(returnType=StringType())
def generate_uuid():
    """Generate a new UUID v4"""
    return str(uuid.uuid4())


@udf(returnType=StringType())
def sanitize_html(html: Optional[str]) -> Optional[str]:
    """
    Sanitize HTML content
    Strip dangerous tags while preserving safe formatting
    """
    if not html:
        return None

    # Simple implementation - in production, use bleach or similar
    import re

    # Remove script, iframe, object tags
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<iframe[^>]*>.*?</iframe>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<object[^>]*>.*?</object>', '', html, flags=re.DOTALL | re.IGNORECASE)

    # Remove javascript: URLs
    html = re.sub(r'javascript:', '', html, flags=re.IGNORECASE)

    return html


@udf(returnType=StringType())
def parse_json_field(json_str: Optional[str]) -> Optional[str]:
    """
    Parse and validate JSON field
    Returns cleaned JSON string or empty object if invalid
    """
    if not json_str:
        return '{}'

    try:
        # Validate JSON
        obj = json.loads(json_str)
        return json.dumps(obj)
    except:
        return '{}'


def create_lookup_udf(context: GlueETLContext, entity_type: str):
    """
    Create a UDF for looking up Zeus IDs from Salesforce IDs

    Args:
        context: GlueETLContext with ID mappings
        entity_type: Entity type to lookup (users, sites, etc.)

    Returns:
        UDF function
    """
    @udf(returnType=StringType())
    def lookup_fn(external_id: Optional[str]) -> Optional[str]:
        return context.lookup_id(entity_type, external_id)

    return lookup_fn


def validate_email(col_name: str) -> DataFrame:
    """
    Validate email address format
    Returns boolean column indicating validity
    """
    email_regex = r'^[\w\.-]+@[\w\.-]+\.\w+$'
    return col(col_name).rlike(email_regex)


def coalesce_int(col_name: str, default_value: int = 0):
    """Coalesce integer column with default value"""
    return when(col(col_name).isNull(), lit(default_value)).otherwise(col(col_name).cast(IntegerType()))


def coalesce_bool(col_name: str, default_value: bool = False):
    """Coalesce boolean column with default value"""
    return when(col(col_name).isNull(), lit(default_value)).otherwise(col(col_name).cast(BooleanType()))


import time
