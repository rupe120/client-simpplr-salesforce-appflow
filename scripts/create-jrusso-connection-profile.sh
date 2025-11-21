#!/usr/bin/env bash

set -euo pipefail

# Create a Salesforce AppFlow connection profile for the jrusso sandbox.
#
# Uses values from lib/config/app-config.ts:
# - Account:       971764590821
# - Region:        us-east-1
# - Secret ARN:    arn:aws:secretsmanager:us-east-1:971764590821:secret:appflow!971764590821-sf-temp-1763741024664-KGA0wB
# - Instance URL:  https://protagona-sf-demo.my.salesforce.com
#
# Prerequisites:
# - AWS CLI v2 installed
# - An AWS CLI profile with permission to call:
#     appflow:CreateConnectorProfile, secretsmanager:GetSecretValue
# - Pass the profile name as the first argument, or set AWS_PROFILE.

PROFILE="${1:-${AWS_PROFILE:-}}"

if [[ -z "${PROFILE}" ]]; then
  echo "Usage: $0 <aws-profile-name>"
  echo "Or set AWS_PROFILE in your environment."
  exit 1
fi

ACCOUNT_ID="971764590821"
REGION="us-east-1"
SALESFORCE_SECRET_ARN="arn:aws:secretsmanager:us-east-1:${ACCOUNT_ID}:secret:appflow!971764590821-sf-temp-1763741024664-KGA0wB"
SALESFORCE_INSTANCE_URL="https://protagona-sf-demo.my.salesforce.com"
CONNECTOR_PROFILE_NAME="migration-tool-salesforce-connection-jrusso"

echo "Creating AppFlow Salesforce connector profile '${CONNECTOR_PROFILE_NAME}' in region '${REGION}' for account '${ACCOUNT_ID}' using profile '${PROFILE}'..."

aws appflow create-connector-profile \
  --region "${REGION}" \
  --profile "${PROFILE}" \
  --connector-profile-name "${CONNECTOR_PROFILE_NAME}" \
  --connector-type Salesforce \
  --connection-mode Public \
  --connector-profile-config "{
    \"connectorProfileProperties\": {
      \"Salesforce\": {
        \"instanceUrl\": \"${SALESFORCE_INSTANCE_URL}\",
        \"isSandboxEnvironment\": false
      }
    },
    \"connectorProfileCredentials\": {
      \"Salesforce\": {
        \"clientCredentialsArn\": \"${SALESFORCE_SECRET_ARN}\"
      }
    }
  }"

echo "Connector profile created (or already exists)."


