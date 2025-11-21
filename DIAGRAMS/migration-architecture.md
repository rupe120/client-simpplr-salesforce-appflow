# Migration Architecture (Mermaid)

This diagram summarizes the `protagona-migration-tool` architecture: extraction (AppFlow), storage, orchestration (Step Functions), transformation (Glue), target (Zeus DB), and monitoring/status tables.

```mermaid
flowchart TD
  %% Swimlane-like layout: left=Extraction, center=Orchestration, right=Transformation, bottom=Storage/Monitoring

  subgraph L [Extraction]
    direction TB
    AppFlow["AppFlow flows\n(per-customer / per-object)"]
    RawS3[["S3: raw-data\n(AppFlow JSON)"]]
    AppFlow -->|writes JSON| RawS3
  end

  subgraph C [Orchestration]
    direction TB
    Pipeline["CDK Pipeline\n(deploy & sync scripts)"]
    StepFunc["Step Functions\n(rank orchestrator)"]
    Pipeline --> StepFunc
  end

  subgraph R [Transformation]
    direction TB
    subgraph R1 [Glue Jobs]
      direction TB
      GlueJobs["Glue Jobs\n(PySpark per-entity)"]
      Rank200[["Rank 200\n(parallel jobs)"]]
      Rank300[["Rank 300\n(wait for Rank 200)"]]
      Rank200 --> Rank300
    end
    Zeus[("Zeus DB\n(Postgres)")]
    ProcessedS3[["S3: processed-data\n(Parquet)"]]
    ErrorS3[["S3: error-data"]]
  end

  subgraph B [Storage & Status]
    direction LR
    ScriptsS3[["S3: glue-scripts"]]
    EMS[("DynamoDB: EMS / TMS")]
  end

  subgraph M [Monitoring]
    direction TB
    CW["CloudWatch Logs / Dashboards"]
    SNS["SNS (failure alerts)"]
  end

  %% Clear flows between swimlanes
  Pipeline -->|sync scripts| ScriptsS3
  ScriptsS3 -->|scriptLocation| GlueJobs

  StepFunc -->|start AppFlow flows| AppFlow
  StepFunc -->|start Glue jobs per-rank| Rank200

  RawS3 -->|read JSON| GlueJobs
  Rank200 --> GlueJobs
  GlueJobs -->|write →| ProcessedS3
  GlueJobs -->|write errors →| ErrorS3
  GlueJobs -->|load →| Zeus
  GlueJobs -->|update EMS| EMS

  GlueJobs -->|emit logs| CW
  GlueJobs -->|on failure| SNS
  StepFunc -->|on failure| SNS
  SNS --> CW

  %% Visual hints and legend
  classDef lane fill:#f8fafc,stroke:#cbd5e1
  class L,C,R,B,M lane

  subgraph Legend[Diagram Legend]
    direction LR
    L1(["AppFlow → S3 (raw)"])
    L2(["Step Functions: orchestrate ranks (AppFlow → Glue)"])
    L3(["Glue: transform → Zeus + processed/error S3"]) 
  end

  %% Explicit styles for key nodes (some Mermaid renderers ignore class on subgraphs)
  style Pipeline fill:#e6f7ff,stroke:#3b82f6,stroke-width:1px
  style AppFlow fill:#fff7ed,stroke:#f59e0b,stroke-width:1px
  style RawS3 fill:#fffbeb,stroke:#f97316,stroke-width:1px
  style GlueJobs fill:#eef2ff,stroke:#7c3aed,stroke-width:1px
  style Rank200 fill:#f1f5f9,stroke:#64748b,stroke-width:1px
  style Rank300 fill:#f1f5f9,stroke:#64748b,stroke-width:1px
  style Zeus fill:#ecfdf5,stroke:#10b981,stroke-width:1px
  style ProcessedS3 fill:#f0fdf4,stroke:#059669,stroke-width:1px
  style ErrorS3 fill:#fff1f2,stroke:#ef4444,stroke-width:1px
  style ScriptsS3 fill:#f0f9ff,stroke:#0369a1,stroke-width:1px
  style EMS fill:#fffbeb,stroke:#92400e,stroke-width:1px
  style CW fill:#f8fafc,stroke:#94a3b8,stroke-width:1px
  style SNS fill:#fff1f2,stroke:#be123c,stroke-width:1px
```

Usage notes
- The Step Functions state machine runs ranks sequentially (e.g., 200 → 300 → ...). For each rank: start AppFlow flows (parallel per source object), wait for completion, then start Glue jobs (parallel per entity).
- Glue jobs use job bookmarks and Spark optimizations; they load ID mapping caches for FK resolution and update EMS/TMS DynamoDB tables after processing.
- The CDK pipeline deploys stacks and uploads Glue scripts to the `scripts` bucket referenced by the Glue jobs.

You can open this file in Markdown preview to render the Mermaid diagram. If you want an expanded diagram (showing sample entities, rank ordering, Glue job DPU allocations, or a swimlane view), tell me which details to include and I’ll update it.