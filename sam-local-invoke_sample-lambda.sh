sam local invoke \
    -t cdk.out/assembly-CdkInitStarterPipelineStack-AppStage/CdkInitStarterPipelineStackAppStageApplicationBusinessLogicStackDDE9BCF9.template.json \
    -e local-execution/sample-lambda/event.json \
    --env-vars local-execution/sample-lambda/env-vars.json \
    --profile sandbox2