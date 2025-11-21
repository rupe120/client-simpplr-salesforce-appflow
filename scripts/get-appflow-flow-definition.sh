#!/usr/bin/env bash

set -euo pipefail

# Get the full definition of an AppFlow flow using an AWS credential profile.
#
# Usage:
#   ./get-appflow-flow-definition.sh <aws-profile-name> <flow-name>
# or:
#   AWS_PROFILE=<aws-profile-name> ./get-appflow-flow-definition.sh <flow-name>
#
# The script prints the full JSON definition returned by:
#   aws appflow describe-flow --flow-name <flow-name>

PROFILE="${AWS_PROFILE:-}"
FLOW_NAME=""

if [[ $# -eq 2 ]]; then
  PROFILE="$1"
  FLOW_NAME="$2"
elif [[ $# -eq 1 ]]; then
  FLOW_NAME="$1"
else
  echo "Usage:"
  echo "  $0 <aws-profile-name> <flow-name>"
  echo "  or: AWS_PROFILE=<aws-profile-name> $0 <flow-name>"
  exit 1
fi

if [[ -z "${PROFILE}" ]]; then
  echo "AWS profile not provided."
  echo "Either pass it as the first argument, or set AWS_PROFILE."
  exit 1
fi

if [[ -z "${FLOW_NAME}" ]]; then
  echo "Flow name is required."
  exit 1
fi

echo "Fetching AppFlow flow definition for '${FLOW_NAME}' using profile '${PROFILE}'..."

aws appflow describe-flow \
  --profile "${PROFILE}" \
  --flow-name "${FLOW_NAME}"


