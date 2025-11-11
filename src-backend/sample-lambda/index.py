import json
import os

def handler(event, context):
    """
    AppFlow Transformation Lambda Function

    This function can handle both:
    1. S3 event triggers (for post-flow processing)
    2. AppFlow inline transformation (synchronous)

    When used as AppFlow inline task, it receives and returns records in this format:
    Input: {'records': [{'field1': 'value1', 'field2': 'value2'}, ...]}
    Output: {'records': [{'transformed_field': 'value', ...}, ...]}
    """

    print(f"Event received: {json.dumps(event)}")

    # Check if this is an AppFlow inline transformation call
    if 'records' in event:
        return handle_appflow_transformation(event, context)

    # Check if this is an S3 event (for post-flow processing)
    elif 'Records' in event and event['Records'][0].get('eventSource') == 'aws:s3':
        return handle_s3_event(event, context)

    # Default response for testing
    else:
        return {
            'statusCode': 200,
            'body': json.dumps('Lambda function ready for AppFlow or S3 events')
        }


def handle_appflow_transformation(event, context):
    """
    Handle AppFlow inline transformation
    This is called synchronously by AppFlow during flow execution
    """
    customer_id = os.environ.get('CUSTOMER_ID', 'unknown')
    salesforce_org_id = os.environ.get('SALESFORCE_ORG_ID', 'unknown')

    print(f"Processing AppFlow transformation for customer: {customer_id}, Salesforce Org: {salesforce_org_id}")

    records = event.get('records', [])
    transformed_records = []

    for record in records:
        # Example transformation: one-to-many based on multi-value fields
        # This demonstrates splitting comma-separated values into multiple records

        # Check if record has a multi-value field that needs splitting
        # For this example, we'll check for any field containing commas
        has_multi_value = False
        multi_value_field = None

        for field_name, field_value in record.items():
            if isinstance(field_value, str) and ',' in field_value and field_name != 'Id':
                has_multi_value = True
                multi_value_field = field_name
                break

        if has_multi_value and multi_value_field:
            # Split into multiple records
            values = record[multi_value_field].split(',')
            for value in values:
                new_record = record.copy()
                new_record[multi_value_field] = value.strip()
                new_record['_original_record_id'] = record.get('Id', 'unknown')
                new_record['_split_from_field'] = multi_value_field
                transformed_records.append(new_record)

            print(f"Split record {record.get('Id')} into {len(values)} records based on field '{multi_value_field}'")
        else:
            # No splitting needed, pass through with potential field transformations
            transformed_record = record.copy()

            # Add metadata
            transformed_record['_customer_id'] = customer_id
            transformed_record['_salesforce_org_id'] = salesforce_org_id
            transformed_record['_processed_by'] = 'appflow-lambda-transform'

            transformed_records.append(transformed_record)

    print(f"Transformed {len(records)} input records into {len(transformed_records)} output records")

    # Return in AppFlow expected format
    return {
        'records': transformed_records
    }


def handle_s3_event(event, context):
    """
    Handle S3 event for post-flow processing
    This is called asynchronously after AppFlow writes to S3
    """
    print("Processing S3 event (post-flow processing)")

    # Extract S3 bucket and key from event
    s3_record = event['Records'][0]['s3']
    bucket = s3_record['bucket']['name']
    key = s3_record['object']['key']

    print(f"S3 object: s3://{bucket}/{key}")

    # In a real implementation, you would:
    # 1. Read the file from S3
    # 2. Parse the Salesforce data
    # 3. Transform the data
    # 4. Write to RDS database

    # For now, just log the event
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'S3 event processed',
            'bucket': bucket,
            'key': key
        })
    }