import json
import os
import boto3
import cfnresponse
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Custom Resource Lambda for RDS Database Initialization

    Creates a database in an external RDS instance if it doesn't exist.
    This is triggered during CloudFormation stack creation/update/delete.

    Properties:
    - RdsHost: RDS endpoint hostname
    - RdsPort: RDS port number
    - DatabaseName: Name of the database to create
    - SecretArn: ARN of the secret containing RDS credentials
    - Engine: Database engine type (postgres, mysql, etc.)
    """

    logger.info(f"Event: {json.dumps(event)}")

    request_type = event['RequestType']
    resource_properties = event['ResourceProperties']

    try:
        rds_host = resource_properties['RdsHost']
        rds_port = int(resource_properties['RdsPort'])
        database_name = resource_properties['DatabaseName']
        secret_arn = resource_properties['SecretArn']
        engine = resource_properties['Engine']

        logger.info(f"Processing {request_type} for database '{database_name}' on {rds_host}:{rds_port}")

        if request_type == 'Create' or request_type == 'Update':
            create_database_if_not_exists(rds_host, rds_port, database_name, secret_arn, engine)
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                'DatabaseName': database_name,
                'Message': f'Database {database_name} initialized successfully'
            })

        elif request_type == 'Delete':
            # On delete, we don't drop the database to prevent data loss
            # The database should be manually deleted if needed
            logger.info(f"Delete request received. Database '{database_name}' will NOT be dropped automatically.")
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                'Message': f'Database {database_name} retained (not dropped)'
            })

        else:
            cfnresponse.send(event, context, cfnresponse.FAILED, {
                'Message': f'Unknown request type: {request_type}'
            })

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        cfnresponse.send(event, context, cfnresponse.FAILED, {
            'Message': str(e)
        })


def create_database_if_not_exists(host, port, database_name, secret_arn, engine):
    """
    Connect to RDS and create the database if it doesn't exist
    """
    # Get credentials from Secrets Manager
    secrets_client = boto3.client('secretsmanager')
    secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
    credentials = json.loads(secret_response['SecretString'])

    username = credentials['username']
    password = credentials['password']

    logger.info(f"Connecting to {engine} database at {host}:{port} as user {username}")

    if engine == 'postgres':
        create_postgres_database(host, port, username, password, database_name)
    elif engine in ['mysql', 'mariadb']:
        create_mysql_database(host, port, username, password, database_name)
    else:
        raise ValueError(f"Unsupported database engine: {engine}")


def create_postgres_database(host, port, username, password, database_name):
    """
    Create PostgreSQL database if it doesn't exist
    """
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

    # Connect to the default 'postgres' database
    conn = psycopg2.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database='postgres'
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)

    cursor = conn.cursor()

    # Check if database exists
    cursor.execute(
        "SELECT 1 FROM pg_database WHERE datname = %s",
        (database_name,)
    )

    exists = cursor.fetchone()

    if exists:
        logger.info(f"Database '{database_name}' already exists")
    else:
        logger.info(f"Creating database '{database_name}'")
        cursor.execute(f'CREATE DATABASE "{database_name}"')
        logger.info(f"Database '{database_name}' created successfully")

    cursor.close()
    conn.close()


def create_mysql_database(host, port, username, password, database_name):
    """
    Create MySQL/MariaDB database if it doesn't exist
    """
    import pymysql

    # Connect to MySQL without specifying a database
    conn = pymysql.connect(
        host=host,
        port=port,
        user=username,
        password=password
    )

    cursor = conn.cursor()

    # Check if database exists
    cursor.execute(
        "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = %s",
        (database_name,)
    )

    exists = cursor.fetchone()

    if exists:
        logger.info(f"Database '{database_name}' already exists")
    else:
        logger.info(f"Creating database '{database_name}'")
        cursor.execute(f"CREATE DATABASE `{database_name}`")
        logger.info(f"Database '{database_name}' created successfully")

    cursor.close()
    conn.close()
