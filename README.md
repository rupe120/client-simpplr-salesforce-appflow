# Simpplr Salesforce Appflow

A comprehensive AWS CDK TypeScript project that demonstrates a full-stack application architecture with CI/CD pipeline, authentication, and multi-environment deployment capabilities.

## Project Overview

This project provides a production-ready foundation for building scalable web applications on AWS, featuring:

- **Multi-environment deployment** (dev, staging, prod) with approval gates
- **CI/CD pipeline** using AWS CodePipeline with GitHub integration
- **Authentication** via AWS Cognito with Google OAuth support
- **Containerized applications** running on ECS Fargate
- **Serverless functions** with Lambda
- **Static website hosting** with CloudFront and S3
- **Database** with DynamoDB
- **Event-driven architecture** with SQS and S3 triggers

## Folder Structure

```
simpplr-salesforce-appflow/
├── bin/                                    # CDK app entry point
│   └── simpplr-salesforce-appflow.ts                # Main CDK app configuration
├── lib/                                    # CDK stack definitions
│   ├── application-core-stack.ts          # Core infrastructure (VPC, ECS cluster, KMS keys)
│   ├── application-storage-stack.ts       # Storage resources (S3, DynamoDB, Cognito)
│   ├── application-business-logic-stack.ts # Application services (Lambda, ECS service)
│   ├── pipeline-stack.ts                 # CI/CD pipeline definition
│   ├── pipeline-app-stage.ts             # Multi-environment stage configuration, containing the instances of the 'application-xxx-stack.ts` stacks above.
│   └── config/
│       └── app-config.ts                 # Application and environment configuration
├── src-backend/                           # Backend application code
│   ├── sample-lambda/                    # Python Lambda function
│   │   └── index.py
│   └── sample-container/                 # Docker container for ECS
│       ├── app.py
│       ├── Dockerfile
│       └── requirements.txt
├── src-frontend/                          # React frontend application
│   ├── src/
│   │   ├── App.tsx                       # Main React component
│   │   ├── AuthExample.tsx              # Cognito authentication example
│   │   ├── cognito-config.ts            # Cognito configuration
│   │   └── useCognitoAuth.ts            # Authentication hook
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   └── tsconfig.json
├── test/                                  # CDK unit tests
│   └── simpplr-salesforce-appflow.test.ts
├── buildspec-frontend.yml                # CodeBuild spec for frontend
├── cdk.json                              # CDK configuration
├── package.json                          # Node.js dependencies
└── README.md
```

## AWS Resources Created

### Core Infrastructure (`ApplicationCoreStack`)
- **VPC** with 3 availability zones
  - Public subnets for load balancers
  - Private subnets for application services
  - Protected subnets for databases
- **ECS Cluster** for containerized applications
- **KMS Keys** for S3 and DynamoDB encryption

### Storage & Authentication (`ApplicationStorageStack`)
- **S3 Buckets**
  - Application data bucket with KMS encryption
  - Static website hosting bucket
- **DynamoDB Table** with customer-managed encryption
- **AWS Cognito**
  - User Pool for authentication
  - Identity Pool for AWS resource access
  - User Pool Client with OAuth support
  - IAM roles for authenticated/unauthenticated users
- **CloudFront Distribution** for static website delivery
- **SQS Queues**
  - Main queue for S3 event processing
  - Dead letter queue for failed messages
- **CloudWatch Log Groups** for Lambda and ECS logging

### Application Services (`ApplicationBusinessLogicStack`)
- **Lambda Function**
  - Python 3.12 runtime
  - Triggered by S3 events via SQS
  - VPC-enabled with security groups
  - Access to S3 and DynamoDB
- **ECS Fargate Service**
  - Application Load Balancer
  - Containerized Python application
  - Health checks on `/health` endpoint
  - VPC-enabled with security groups
  - Access to S3 and DynamoDB

### CI/CD Pipeline (`PipelineStack`)
- **AWS CodePipeline** with GitHub integration
- **Multi-environment deployment** support
- **Manual approval gates** for production environments
- **Cross-account deployment** capabilities

## Configuration

The application is configured through `lib/config/app-config.ts`:

- **Application settings**: Name, version
- **Pipeline configuration**: GitHub repository, connection ARN
- **Environment settings**: Account IDs, regions, VPC configuration
- **Authentication**: Google OAuth client configuration
- **CloudFront**: Domain names for static hosting

## Prerequisites

Before deploying this infrastructure, ensure you have:

- **AWS CLI** configured with appropriate credentials
- **Node.js** (v18 or later) and npm installed
- **AWS CDK CLI** installed (`npm install -g aws-cdk`)
- **GitHub repository** with AWS CodeConnections configured
- **Multiple AWS accounts** for pipeline and environment separation

## CDK Bootstrap Setup

This project uses a multi-account deployment strategy with cross-account trust relationships. You must bootstrap CDK in both the pipeline account and all environment accounts.

### 1. Bootstrap Pipeline Account

The pipeline account (`971764590821`) hosts the CI/CD pipeline and needs to be bootstrapped first:

```bash
# Bootstrap the pipeline account
npx cdk bootstrap aws://971764590821/us-east-1 --profile pipeline-account
```

### 2. Bootstrap Environment Accounts

Each environment account needs to be bootstrapped with trust configuration for the pipeline account:

```bash
# Bootstrap dev environment account
npx cdk bootstrap aws://533101977259/us-east-1 \
  --trust 971764590821 \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
  --profile dev-account
```

### 3. Trust Configuration Details

The trust configuration enables the pipeline account to deploy resources in environment accounts:

- **Trust Account**: `971764590821` (pipeline account)
- **Environment Account**: `533101977259` (dev environment)
- **Permissions**: AdministratorAccess (or customize as needed)

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure your environment**:
   - Update `lib/config/app-config.ts` with your AWS account IDs
   - Configure GitHub connection ARN for the pipeline
   - Set up Google OAuth credentials if needed

3. **Deploy the pipeline**:
   ```bash
   npx cdk deploy SimpplrSalesforceAppflowPipelineStack
   ```

4. **Deploy to specific environment**:
   ```bash
   npx cdk deploy --app "npx ts-node bin/simpplr-salesforce-appflow.ts" <stack-name>
   ```

## Local Development & Testing

### SAM Local Invoke (Lambda Testing)

Test Lambda functions locally using AWS SAM CLI:

**Bash/Linux/macOS:**
```bash
./sam-local-invoke_sample-lambda.sh
```

**PowerShell/Windows:**
```powershell
./sam-local-invoke_sample-lambda.ps1
```

**What it does:**
- Invokes the sample Lambda function locally using the synthesized CloudFormation template
- Uses test event from `local-execution/sample-lambda/event.json`
- Loads environment variables from `local-execution/sample-lambda/env-vars.json`
- Uses AWS profile `sandbox2` for credentials

**Prerequisites:**
- AWS SAM CLI installed (`pip install aws-sam-cli`)
- CDK stacks synthesized (`npx cdk synth`)

### Docker Run (Container Testing)

Run the sample container application locally:

**Bash/Linux/macOS:**
```bash
./docker-run_sample-container.sh
```

**PowerShell/Windows:**
```powershell
./docker-run_sample-container.ps1
```

**What it does:**
- Runs the sample containerized application on port 8000
- Configures environment variables for AWS Cognito integration
- Automatically retrieves AWS credentials from `sandbox2` profile
- Container includes all necessary dependencies and application code

**Access the application:**
- Open `http://localhost:8000` in your browser
- The application will be available with Cognito authentication configured

**Prerequisites:**
- Docker installed and running
- AWS CLI configured with `sandbox2` profile
- Container image built (`./docker-build_sample-container.sh`)

### Configuration Files

**Lambda Environment Variables** (`local-execution/sample-lambda/env-vars.json`):
- Contains AWS account ID and Cognito configuration
- Update these values to match your deployed infrastructure

**Lambda Test Event** (`local-execution/sample-lambda/event.json`):
- Empty JSON object `{}` for basic Lambda invocation
- Modify to simulate specific event types (S3, SQS, etc.)

## Useful Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Perform Jest unit tests
* `npx cdk deploy` - Deploy stacks to your default AWS account/region
* `npx cdk diff`   - Compare deployed stack with current state
* `npx cdk synth`  - Emit the synthesized CloudFormation template
* `npx cdk destroy` - Destroy deployed stacks
