docker run `
    --rm `
    --name sample-container `
    -p 8000:8000 `
    -e ACCOUNT_ID="533101977259" `
    -e COGNITO_USER_POOL_ID="us-east-1_DUcNDQniU" `
    -e COGNITO_IDENTITY_POOL_ID="us-east-1:625d469e-27fd-4bf2-8997-75fb3773a02c" `
    -e COGNITO_USER_POOL_CLIENT_ID="1cpsh9nsu1mk651o6v7s06t5fj" `
    -e COGNITO_REGION="us-east-1" `
    -e COGNITO_DOMAIN="dev.example.com" `
    -e AWS_ACCESS_KEY_ID="$(aws configure get aws_access_key_id --profile sandbox2)" `
    -e AWS_SECRET_ACCESS_KEY="$(aws configure get aws_secret_access_key --profile sandbox2)" `
    -e AWS_SESSION_TOKEN="$(aws configure get aws_session_token --profile sandbox2)" `
    -e AWS_DEFAULT_REGION="$(aws configure get region --profile sandbox2)" `
    sample-container