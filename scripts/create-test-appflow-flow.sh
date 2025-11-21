#!/usr/bin/env bash

set -euo pipefail

# Create a single AppFlow flow that matches the definition in lib/migration-appflow-stack.ts
# using an example configuration:
# - Salesforce connector profile: sf-temp
# - Salesforce object: User
# - Destination bucket: migration-tool-migration-storage-jrusso-raw-data
# - Region: us-east-1
#
# Usage:
#   ./create-test-appflow-flow.sh <aws-profile-name> [flow-name]
# or:
#   AWS_PROFILE=<aws-profile-name> ./create-test-appflow-flow.sh [flow-name]
#
# If flow name is omitted, a default will be used.

PROFILE="${AWS_PROFILE:-}"
FLOW_NAME_DEFAULT="migration-tool-customer-001-user-jrusso"

if [[ $# -ge 1 ]]; then
  PROFILE="$1"
fi

if [[ -z "${PROFILE}" ]]; then
  echo "AWS profile not provided."
  echo "Either pass it as the first argument, or set AWS_PROFILE."
  exit 1
fi

FLOW_NAME="${2:-$FLOW_NAME_DEFAULT}"

REGION="us-east-1"
CONNECTOR_PROFILE_NAME="${CONNECTOR_PROFILE_NAME:-sf-temp}"
BUCKET_NAME="${BUCKET_NAME:-migration-tool-migration-storage-jrusso-raw-data}"
SALESFORCE_OBJECT="${SALESFORCE_OBJECT:-User}"

echo "Creating AppFlow flow '${FLOW_NAME}' in region '${REGION}' using profile '${PROFILE}'..."
echo "  Connector profile: ${CONNECTOR_PROFILE_NAME}"
echo "  Salesforce object: ${SALESFORCE_OBJECT}"
echo "  Destination bucket: ${BUCKET_NAME}"

aws appflow create-flow \
  --region "${REGION}" \
  --profile "${PROFILE}" \
  --flow-name "${FLOW_NAME}" \
  --trigger-config '{
    "triggerType": "OnDemand"
  }' \
  --source-flow-config "{
    \"connectorType\": \"Salesforce\",
    \"connectorProfileName\": \"${CONNECTOR_PROFILE_NAME}\",
    \"sourceConnectorProperties\": {
      \"Salesforce\": {
        \"object\": \"${SALESFORCE_OBJECT}\",
        \"enableDynamicFieldUpdate\": true,
        \"includeDeletedRecords\": false
      }
    }
  }" \
  --destination-flow-config-list "[
    {
      \"connectorType\": \"S3\",
      \"destinationConnectorProperties\": {
        \"S3\": {
          \"bucketName\": \"${BUCKET_NAME}\",
          \"s3OutputFormatConfig\": {
            \"fileType\": \"PARQUET\",
            \"prefixConfig\": {
              \"prefixType\": \"PATH\",
              \"prefixFormat\": \"DAY\"
            }
          }
        }
      }
    }
  ]" \
  --tasks "[
    {
      \"taskType\": \"Map_all\",
      \"sourceFields\": [],
      \"taskProperties\": {},
      \"connectorOperator\": {
        \"Salesforce\": \"NO_OP\"
      }
    }
  ]"

echo "Flow '${FLOW_NAME}' creation requested."


