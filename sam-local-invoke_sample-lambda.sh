sam local invoke \
    -t cdk.out/assembly-SimpplrSalesforceAppflowPipelineStack-AppStage/SimpplrSalesforceAppflowPipelineStackAppStageMigrationBusinessLogicStack*.template.json \
    -e local-execution/sample-lambda/event.json \
    --env-vars local-execution/sample-lambda/env-vars.json \
    --profile sandbox2