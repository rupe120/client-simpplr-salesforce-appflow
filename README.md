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

### Storage & Authentication (`MigrationStorageStack`)
- **Application S3 Buckets**
  - Application data bucket with KMS encryption
  - Static website hosting bucket
- **Migration S3 Buckets**
  - Raw data bucket (AppFlow output)
  - Processed data bucket (Glue job results)
  - Error data bucket (failed records)
  - Scripts bucket (Glue job scripts)
  - Temp bucket (temporary processing data)
  - Logs bucket (Spark/Glue logs)
- **DynamoDB Tables**
  - Application table with customer-managed encryption
  - Entity Migration Status (EMS) table
  - Tenant Migration Status (TMS) table
- **AWS Cognito**
  - User Pool for authentication
  - Identity Pool for AWS resource access
  - User Pool Client with OAuth support
  - IAM roles for authenticated/unauthenticated users
- **SQS Queues**
  - Main queue for S3 event processing
  - Dead letter queue for failed messages
- **CloudWatch Log Groups** for Lambda and ECS logging

### Application & Migration Services (`MigrationBusinessLogicStack`)
- **Application Services**
  - **Lambda Function** - Python 3.12 runtime, triggered by S3 events via SQS
  - **AppFlow Flows** - Regular sync flows from Salesforce to RDS per customer
  - **RDS Database Initialization** - Custom resource Lambda for database setup
- **Migration Services**
  - **Migration AppFlow Flows** - Extract data from Salesforce to S3 for migration
  - **Glue ETL Jobs** - Transform data from S3 to Zeus DB (200+ jobs)
  - **Step Functions State Machine** - Orchestrate migration execution
  - **CloudWatch Monitoring** - Dashboards and alerts for migration

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

## Migration Stacks

This project includes comprehensive migration infrastructure for migrating data from Odin (Salesforce) to Zeus (PostgreSQL/MongoDB) using AWS Glue, AppFlow, and Step Functions.

### Migration Stack Components

1. **MigrationStorageStack** - S3 buckets and DynamoDB tables
   - Raw data bucket (AppFlow output)
   - Processed data bucket (Glue job results)
   - Error data bucket (failed records)
   - Scripts bucket (Glue job scripts)
   - EMS and TMS DynamoDB tables for migration status tracking

2. **MigrationAppFlowStack** - AppFlow flows for data extraction
   - Creates AppFlow flows for each customer and Salesforce object
   - Extracts data from Salesforce and stores in S3

3. **MigrationGlueStack** - Glue ETL jobs
   - Creates Glue jobs for each entity type
   - Configures Glue Data Catalog and VPC connections
   - Sets up Spark optimizations for performance

4. **MigrationStepFunctionsStack** - Orchestration
   - Step Functions state machine for coordinating migration
   - Executes Glue jobs in parallel within ranks, sequentially across ranks

5. **MigrationMonitoringStack** - Monitoring and alerts
   - CloudWatch dashboards for migration metrics
   - SNS topics for failure and success notifications
   - CloudWatch alarms for error detection

### Deploying Migration Stacks

Migration stacks are automatically deployed as part of the CDK Pipeline for each environment. They are defined in `lib/pipeline-app-stage.ts` and will be deployed when the pipeline runs.

**Prerequisites:**
- Secrets Manager secrets for Zeus DB and CDC DB connections must exist before deployment
  - Secret names: `migration-zeus-db-secret-{environment}` and `migration-cdc-db-secret-{environment}`
  - Or provide custom names via pipeline context: `zeusDbSecretName` and `cdcDbSecretName`
- VPC with RDS instances accessible
- AppFlow connection profile configured

**Deploy via Pipeline:**
The migration stacks are included in the pipeline and will be deployed automatically when you deploy the pipeline stack:
```bash
npx cdk deploy SimpplrSalesforceAppflowPipelineStack
```

**Custom Secret Names:**
If your secrets use different names, you can pass them via pipeline context:
```bash
# Update pipeline-stack.ts to pass context to stages
# Or set them in cdk.json under context
```

### Migration Configuration

Migration-specific configuration is in `lib/config/migration-config.ts`:
- Glue job DPU allocation per entity
- Step Functions timeout and retry settings
- S3 data retention policies
- Entity to job mapping

### Performance Optimizations

All migration stacks include Spark/Glue performance optimizations:
- Adaptive Query Execution (AQE) enabled
- Broadcast joins for small reference datasets
- Parquet format for columnar storage
- Optimized partitioning and DPU allocation
- See `MIGRATION_IMPLEMENTATION_PLAN.md` for detailed performance considerations

## Useful Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Perform Jest unit tests
* `npx cdk deploy` - Deploy stacks to your default AWS account/region
* `npx cdk diff`   - Compare deployed stack with current state
* `npx cdk synth`  - Emit the synthesized CloudFormation template
* `npx cdk destroy` - Destroy deployed stacks
* `npm run deploy:migration` - Deploy all migration stacks
* `npm run synth:migration` - Synthesize migration stacks
