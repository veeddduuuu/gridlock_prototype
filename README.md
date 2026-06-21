# gridlock_prototype

# GridLock Project 2

An AI-powered Traffic Command Center for forecasting and managing event-driven congestion caused by planned and unplanned events. The system predicts congestion, simulates its propagation across the road network, recommends interventions such as fleet dispatch and barricade placement, and provides an AI assistant for traffic controllers.

---

# Architecture

## 1. High level Architecture

``` mermaid
---
config:
  theme: mc
  look: handDrawn
  fontFamily: "'Recursive Variable', sans-serif"
---
flowchart LR

%% =========================
%% CLIENT LAYER
%% =========================
subgraph CLIENT["Client Layer"]
    LP["Landing Page"]

    subgraph DASH["Dashboards"]
        CD["Controller Dashboard<br/>(React + Vite)"]
        FD["Fleet Dashboard<br/>(React + Vite)"]
    end
end

%% =========================
%% API LAYER
%% =========================
subgraph API_LAYER["API Layer (Node.js + Express)"]
    API["REST API Server"]
    WSS["WebSocket Gateway"]
    PW["Propagation Worker<br/>(BullMQ)"]
end

%% =========================
%% ML LAYER
%% =========================
subgraph ML["ML Service (FastAPI + Python)"]

    MLP["Prediction Engine"]

    subgraph MODELS["Analytics Models"]
        MLA["Anomaly Detection<br/>(Prophet)"]
        MLQ["Queueing Model<br/>(M/M/c/K)"]
        MLF["Traffic Fingerprinting"]
        MLC["Counterfactual Engine"]
    end
end

%% =========================
%% DATA LAYER
%% =========================
subgraph DATA["Data Layer"]
    PG[("PostgreSQL")]
    RD[("Redis<br/>Queue + Cache + Pub/Sub")]
end

%% =========================
%% EXTERNAL SERVICES
%% =========================
subgraph EXT["External Services"]
    MAPPLS["Mappls API"]
    GROQ["Groq LLM"]
end

%% =========================
%% CLIENT CONNECTIONS
%% =========================
CD <-->|REST| API
FD <-->|REST| API

CD <-->|Live Updates| WSS
FD <-->|Live Updates| WSS

%% =========================
%% API CONNECTIONS
%% =========================
API -->|ML Requests| MLP
API -->|SQL| PG
API -->|Queue Jobs| RD

PW <-->|BullMQ| RD
PW -->|Simulation Ticks| WSS

%% =========================
%% ML CONNECTIONS
%% =========================
MLA --> MLP
MLQ --> MLP
MLF --> MLP
MLC --> MLP

%% =========================
%% EXTERNALS
%% =========================
API -->|Distance Matrix| MAPPLS
API -->|LLM Analysis| GROQ

%% =========================
%% STYLING
%% =========================
classDef Ash fill:#EEEEEE,stroke:#999999,color:#000000;

class LP,CD,FD,API,WSS,PW,MLP,MLA,MLQ,MLF,MLC,PG,RD,GROQ,MAPPLS Ash;
```

## 2. Infrastructure (Docker Compose topology)

```mermaid
graph LR
    subgraph "docker-compose"
        REDIS["redis<br/>redis:7-alpine<br/>:6379<br/>Pub/Sub · BullMQ · State store"]
        BACKEND["backend<br/>apps/backend<br/>:4000<br/>Express API + WS + BullMQ Worker"]
        FRONTEND["frontend<br/>apps/frontend<br/>:5173<br/>Vite + React SPA"]
        ML["ml<br/>apps/ml<br/>:8000<br/>FastAPI ML Service"]
        MLFLOW["mlflow<br/>python:3.11-slim<br/>:5001<br/>MLflow Experiment Tracker"]
    end

    EXTPG[("External PostgreSQL<br/>via DATABASE_URL")]

    FRONTEND -->|REST + WS| BACKEND
    BACKEND -->|HTTP /api/ml/*| ML
    BACKEND -->|Pub/Sub + Queue| REDIS
    BACKEND -->|SQL| EXTPG
    ML -.->|logs experiments| MLFLOW
```

## 3. Database Schema (ERD)

```mermaid
erDiagram
    events ||--o{ fleet_assignments : "has"
    events ||--o{ barricades : "has"
    users ||--o{ fleet_assignments : "assigned to"
    users ||--o{ barricades : "may manage"

    events {
        UUID id PK
        VARCHAR type "planned | unplanned"
        VARCHAR category "accident | public_event | etc"
        FLOAT lat
        FLOAT lon
        TIMESTAMP start_datetime
        FLOAT severity_score
        VARCHAR status "created | planned | active | closed"
        JSONB deployment_plan
        JSONB gating_plan
        JSONB propagation_forecast
        JSONB prestaging_timeline
        JSONB diversion_plan
        FLOAT anomaly_score
    }

    users {
        UUID id PK
        VARCHAR email
        VARCHAR role "controller | fleet"
        VARCHAR status "available | dispatched | on_site | off_duty"
        FLOAT current_lat
        FLOAT current_lon
    }

    fleet_assignments {
        UUID id PK
        UUID event_id FK
        UUID user_id FK
        VARCHAR junction_name
        VARCHAR role "traffic_direction | incident_clearance | diversion_management"
        VARCHAR status "pending | en_route | on_site | completed"
    }

    barricades {
        UUID id PK
        UUID event_id FK
        VARCHAR junction_id
        VARCHAR type "hard_closure | diversion_sign"
        VARCHAR rule_source "road_closure | severity_path | crowd_perimeter"
        VARCHAR status "recommended | confirmed | removed"
    }
```

---

## 4. Backend Service Layer

```mermaid
graph LR
    subgraph "Core Simulation"
        GS["GraphService<br/>294 junctions, adjacency list,<br/>BFS, corridor cascade weights"]
        SS["SimulationService<br/>BFS propagation engine,<br/>tick-based spread + decay"]
    end

    subgraph "AI Decision Engines"
        RS["RecommendationService<br/>Fleet dispatch: LLM + fallback rules,<br/>uncertainty assessment, fleet allocation"]
        BS["BarricadeService<br/>3 rule types + LLM explanation,<br/>road closure / severity / crowd"]
        DS["DiversionService<br/>Graph-walk corridor rerouting,<br/>cascade-risk ranking + LLM prose"]
    end

    subgraph "Supporting Services"
        QS["QueueService<br/>BullMQ job scheduling,<br/>Redis pub/sub publishing"]
        CS["ConflictService<br/>Spatio-temporal overlap detection<br/>within 1.5km radius"]
        AS["AmbientService<br/>LLM-generated radio chatter<br/>situational updates"]
        CHS["ChatService<br/>Context-aware AI chatbot<br/>via Groq"]
        MS["MapplsService<br/>Distance matrix API<br/>for ETA-based dispatch"]
    end

    GS --> SS
    GS --> RS
    GS --> BS
    GS --> DS
    SS --> RS
    SS --> BS
    RS --> MS
    QS --> SS
    CS --> RS
```

---

## 5. The 9-Stage Planning Pipeline

```mermaid
graph TD
    A["1. INSERT event (status='planned')"] --> B["2. ML Prediction<br/>(duration + severity + confidence + conformal interval)"]
    B --> C["3a. Queue Analysis<br/>(M/M/c/K blocking probability + tandem spillback)"]
    B --> C2["3b. Anomaly Detection<br/>(Prophet corridor baseline deviation)"]
    C --> D["4. Propagation Forecast<br/>(BFS simulation at T+5, T+10, T+15, T+30)"]
    D --> E["5a. Fleet Dispatch Plan<br/>(LLM + uncertainty reserve + ETA-ranked assignment)"]
    D --> E2["5b. Barricade Plan<br/>(3 rules engine + LLM explanation)"]
    D --> E3["5c. Diversion Plan<br/>(graph-walk corridor rerouting + competing-event awareness)"]
    E --> F["6. Advisory Gating<br/>(upstream signal timing recommendations)"]
    F --> G["7. Pre-staging Timeline<br/>(T-60 to T+duration countdown)"]
    G --> H["8. Persist all to PostgreSQL + WebSocket broadcast"]
    H --> I["9. Schedule BullMQ propagation job (30s ticks)"]
```

---

## 6. Real-Time Propagation Worker Logic

*(Converted from the prose description in Section 3.6 of the source doc.)*

```mermaid
flowchart TD
    START(["Every 30 seconds, per active event"]) --> READ["Read propagation state from Redis"]
    READ --> FETCH["Fetch interventions<br/>(barricades + fleet deployments)"]
    FETCH --> SCAN["Scan all other active events'<br/>propagation states (gridlock detection)"]
    SCAN --> TICK["simulationService.tick()"]

    subgraph "tick() logic"
        T1["5% spread chance per tick<br/>× edge weight × intensity"]
        T2["Intensity decay:<br/>initialSeverity / (durationMins × 2)"]
        T3["Barricade blocking<br/>(stops propagation at barricaded nodes)"]
        T4["Fleet acceleration<br/>(1.5× decay at deployed nodes)"]
        T5["Queue spillback<br/>(guaranteed spread at intensity ≥ 1.0)"]
        T6["Multi-event merge<br/>(guaranteed spread + intensity spike on collision)"]
    end

    TICK --> T1 --> T2 --> T3 --> T4 --> T5 --> T6
    T6 --> PUB["Publish propagation:tick<br/>via Redis → WebSocket → frontend heatmap"]
    PUB --> CHECK{"Every 4th tick<br/>(2 min)?"}
    CHECK -- "Yes" --> SITREP["Generate ambient LLM SITREP"]
    CHECK -- "No" --> END(["Wait for next tick"])
    SITREP --> END
```

---

## 7. ML Prediction Engine

```mermaid
graph TD
    A["Input Event"] --> B["Feature Engineering<br/>(Encoders + FeaturePipeline F4/F5)"]
    B --> C{"Artifact Format?"}
    C -- "Champion" --> D["Champion Model<br/>(any sklearn/LGB/XGB)"]
    C -- "Legacy" --> E["LGB multi-seed + CatBoost<br/>blend_weight ensemble"]
    D --> F{"Regime Models?"}
    F -- "Enabled" --> G["Soft-blend: sigmoid routing<br/>short_model ↔ long_model"]
    F -- "Disabled" --> H["Champion prediction only"]
    G --> I["log1p → expm1 → duration_mins"]
    H --> I
    E --> I
    I --> J["Severity Score Engineering"]
    I --> K["Conformal Interval<br/>(corridor → severity → global fallback)"]
    I --> L["Dynamic Confidence<br/>(ensemble variance penalty)"]
    I --> M["Fingerprint Search<br/>(haversine + hour + cause similarity)"]
```

---

## 8. ML Service API Surface

*(Converted from the endpoint table in Section 4.1 of the source doc.)*

```mermaid
graph LR
    subgraph "FastAPI :8000"
        PRED["POST /api/ml/predict<br/>predict.py"]
        REPRED["POST /api/ml/repredict<br/>active.py"]
        QUEUE["POST /api/ml/queue-analysis<br/>queue_model.py"]
        DEPLOY["POST /api/ml/deployment<br/>queue_model.py"]
        GATE["POST /api/ml/gating<br/>queue_model.py"]
        ANOM["POST /api/ml/anomaly<br/>anomaly.py"]
        CF["POST /api/ml/counterfactual<br/>counterfactual.py"]
        ACC["POST /api/ml/accuracy<br/>service.py"]
        TRAIN["POST /api/ml/train-baselines<br/>anomaly.py"]
    end

    PRED -->|"Ensemble (LightGBM/CatBoost/<br/>Stacking champion) + conformal +<br/>fingerprinting"| PREDALG["Ensemble model"]
    REPRED -->|"Live re-estimation using<br/>elapsed time + conformal interval"| REPREDALG["Active re-prediction"]
    QUEUE -->|"M/M/c/K queueing theory +<br/>tandem corridor analysis"| QUEUEALG["Queueing model"]
    DEPLOY -->|"Greedy knapsack resource<br/>allocation"| DEPLOYALG["Knapsack optimizer"]
    GATE -->|"Advisory green-time<br/>reduction"| GATEALG["Signal timing rules"]
    ANOM -->|"Prophet corridor baselines +<br/>adaptive thresholds"| ANOMALG["Prophet model"]
    CF -->|"What-if policy regret<br/>computation"| CFALG["Counterfactual engine"]
    ACC -->|"Prediction accuracy<br/>tracking"| ACCALG["Accuracy tracker"]
    TRAIN -->|"Retrain Prophet corridor<br/>models"| TRAINALG["Training job"]
```

---

## 9. Frontend Routing & Auth

```mermaid
graph TD
    R["/"] --> LP["LandingPage (Public)"]
    R2["/login/controller"] --> CL["ControllerLogin"]
    R3["/login/fleet"] --> FL["FleetLogin"]
    R4["/dashboard/*"] --> PR1["ProtectedRoute (controller)"]
    PR1 --> AL["AppLayout (Sidebar + Header)"]
    AL --> M["/dashboard/map → LiveMapPage"]
    AL --> O["/dashboard/overview → OverviewPage"]
    AL --> P["/dashboard/performance → PerformancePage"]
    AL --> H["/dashboard/history → EventHistoryPage"]
    AL --> DR["/dashboard/reports → DetailedReportsPage"]
    AL --> S["/dashboard/settings → SettingsPage"]
    R5["/fleet"] --> PR2["ProtectedRoute (fleet)"]
    PR2 --> FDB["FleetDashboard"]
```

---

## 10. Real-Time Data Flow (Sequence Diagram)

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant WS as WebSocket
    participant API as Backend API
    participant RD as Redis
    participant W as BullMQ Worker

    FE->>API: POST /api/events/plan
    API->>API: Run 9-stage pipeline
    API->>RD: Publish "recommendations:ready"
    RD->>WS: Forward to channel subscribers
    WS->>FE: Push WS message
    FE->>FE: Toast "AI Dispatch Plan Ready"

    loop Every 30 seconds
        W->>RD: Read propagation state
        W->>W: Run simulation tick
        W->>RD: Write updated state
        W->>RD: Publish "propagation:tick"
        RD->>WS: Forward
        WS->>FE: Push tick data
        FE->>FE: Update heatmap circles on map
    end

    FE->>WS: fleet:location_update
    WS->>RD: Publish "controller:fleet_locations"
    RD->>WS: Forward
    WS->>FE: Update fleet markers
```

---

## 11. LLM Integration Layer (Groq)

*(Converted from the table in Section 6 of the source doc.)*

```mermaid
graph LR
    GROQ(["Groq-hosted LLM"])

    subgraph "Services using Groq"
        RS2["RecommendationService<br/>Generate fleet dispatch plan JSON"]
        BS2["BarricadeService<br/>Write barricade placement explanations"]
        DS2["DiversionService<br/>Write diversion route explanations"]
        AS2["AmbientService<br/>Radio-chatter situational updates"]
        CHS2["ChatService<br/>Context-aware AI chatbot"]
    end

    subgraph "Deterministic Fallbacks"
        F1["Escalation-tier rules +<br/>ETA-ranked assignment"]
        F2["Rule-based: closure /<br/>severity / crowd"]
        F3["Graph-walk corridor<br/>rerouting"]
        F4["Skipped silently"]
        F5["Returns error message"]
    end

    RS2 --> GROQ
    BS2 --> GROQ
    DS2 --> GROQ
    AS2 --> GROQ
    CHS2 --> GROQ

    GROQ -.->|"on failure"| F1
    GROQ -.->|"on failure"| F2
    GROQ -.->|"on failure"| F3
    GROQ -.->|"on failure"| F4
    GROQ -.->|"on failure"| F5

    F1 -.-> RS2
    F2 -.-> BS2
    F3 -.-> DS2
    F4 -.-> AS2
    F5 -.-> CHS2

    NOTE["Design pattern: rules engines always run first<br/>to produce the structural plan.<br/>The LLM only adds prose/explanations."]
```

---

## 12. Complete Request Lifecycle

*(Converted from the prose pipeline in Section 8 of the source doc.)*

```mermaid
flowchart TD
    A["User submits event via PlanEventForm"] --> B["POST /api/events/plan<br/>(JWT-authenticated)"]
    B --> C["INSERT into PostgreSQL → event_id"]
    C --> D["WebSocket broadcast: event:new"]
    D --> E["HTTP POST → ML Service /api/ml/predict"]

    subgraph "Prediction"
        E --> E1["Feature engineering<br/>(encoders + pipeline)"]
        E1 --> E2["Champion model predict (log-space)"]
        E2 --> E3["Conformal interval<br/>(corridor → severity → global)"]
        E3 --> E4["Fingerprint search<br/>(k-NN on reference corpus)"]
        E4 --> E5["Returns: duration, severity,<br/>confidence, interval, similar events"]
    end

    E5 --> F["HTTP POST → ML Service /api/ml/queue-analysis"]
    F --> F1["M/M/c/K + tandem queue computation"]
    F1 --> F2["Returns: blocking_probability,<br/>risk_level, spillover time"]

    F2 --> G["HTTP POST → ML Service /api/ml/anomaly"]
    G --> G1["Prophet baseline comparison"]
    G1 --> G2["Returns: anomaly_score, anomaly_label"]

    G2 --> H["SimulationService.getCongestionForecast()"]
    H --> H1["BFS propagation at T+0/T+15/T+30<br/>(no interventions)"]

    H1 --> I["RecommendationService.generateDispatchPlan()"]
    I --> I1["MapplsService.getDistanceMatrix() for real ETAs"]
    I1 --> I2["Groq LLM generates dispatch JSON (or fallback rules)"]
    I2 --> I3["assignNearestFleet() with ETA-based ranking"]
    I3 --> I4["assessUncertainty() → contingency reserve"]

    I4 --> J["BarricadeService.generateBarricadePlan()"]
    J --> J1["3 rules: road_closure + severity_path + crowd_perimeter"]
    J1 --> J2["Groq LLM writes explanations (or fallback)"]

    J2 --> K["DiversionService.generateDiversionPlan()"]
    K --> K1["Graph-walk corridor X, find transfers to corridor Y"]
    K1 --> K2["Avoid corridors used by competing events"]
    K2 --> K3["Groq LLM writes explanations (or fallback)"]

    K3 --> L["callGating() → ML Service /api/ml/gating"]
    L --> L1["Green-time reduction at upstream junctions"]

    L1 --> M["buildPrestagingTimeline()"]
    M --> M1["T-60 to T+duration operational countdown"]

    M1 --> N["UPDATE 17 columns in PostgreSQL"]
    N --> O["WebSocket broadcast:<br/>recommendations:ready, barricades:ready"]
    O --> P["schedulePropagationJob() → BullMQ (30s recurring)"]

    P --> Q["Worker reads state from Redis"]
    Q --> R["Runs tick (spread + decay + interventions)"]
    R --> S["Publishes propagation:tick →<br/>Redis → WebSocket → Map heatmap"]
    S -.->|"loop every 30s"| Q
```

---

## 13. Key Algorithms Map

*(Converted from the algorithm summary table in Section 7 of the source doc.)*

```mermaid
graph LR
    subgraph "Backend (TypeScript)"
        ALG1["BFS Congestion Propagation<br/>SimulationService.tick()"]
        ALG2["Queue Spillback<br/>SimulationService.tick()"]
        ALG3["Multi-Event Gridlock Merge<br/>propagation.worker.ts"]
        ALG4["Severity-Weighted Fleet Allocation<br/>recommendation.service.ts"]
        ALG5["Graph-Walk Diversion Routing<br/>diversion.service.ts"]
    end

    subgraph "ML Service (Python)"
        ALG6["M/M/c/K Queueing<br/>queue_model.py"]
        ALG7["Tandem Queue Spillback<br/>queue_model.py"]
        ALG8["Conformal Prediction Intervals<br/>predict.py"]
        ALG9["Prophet Anomaly Detection<br/>anomaly.py"]
        ALG10["Haversine Fingerprinting<br/>fingerprint.py"]
        ALG11["Greedy Knapsack Deployment<br/>queue_model.py"]
    end
```


---



# Users

## 1. Controller

Traffic command center operators responsible for:

* Monitoring traffic conditions
* Managing events
* Deploying fleet members
* Placing barricades
* Viewing congestion heatmaps
* Interacting with the AI assistant

## 2. Fleet Member

On-ground personnel responsible for:

* Receiving dispatch instructions
* Viewing assigned routes
* Reporting road conditions
* Updating barricade status
* Sending incident updates

---

# Features

## 1. Role-Based Access Control (RBAC)

### Controller

* Create and manage events
* View analytics and predictions
* Dispatch fleets
* Place barricades
* Access AI chatbot
* View heatmaps and simulations

### Fleet Member

* View assignments
* Update task status
* Report incidents
* Share real-time updates

---

## 2. Ambient AI Engine

Continuously processes:

* Historical traffic data
* Event information
* Fleet updates
* Real-time traffic signals
* Incident reports

Capabilities:

* Background traffic monitoring
* Dynamic congestion prediction
* Automatic intervention recommendations
* Continuous learning from new events

---

## 3. Congestion Propagation Engine

Simulates how traffic congestion spreads across the road network.

### Heatmap Generation

Displays:

🟢 Low congestion

🟡 Medium congestion

🔴 Severe congestion

Predictions for:

* 5 minutes
* 15 minutes
* 30 minutes

---

### Barricade Placement Optimizer

Recommends:

* Optimal barricade locations
* Required number of barricades
* Activation timings

Objective:

Reduce congestion spillover and improve traffic flow.

---

### Fleet Dispatch Engine

Recommends:

* Number of fleet members required
* Deployment locations
* Priority intervention zones
* Dynamic reassignment during incidents

---

## 4. Planned and Unplanned Event Management

### Planned Events

* Festivals
* Sports events
* Political rallies
* Concerts
* Construction activities

### Unplanned Events

* Accidents
* Sudden gatherings
* Protests
* Emergency road closures

The system automatically adjusts recommendations based on event type and severity.

---

## 5. Time-Based Forecasting

Supports traffic forecasting at multiple horizons:

* Real-time
* +5 minutes
* +15 minutes
* +30 minutes
* Event start and end windows

Predictions include:

* Congestion score
* Expected delays
* Affected roads
* Resource requirements

---

## 6. AI Chatbot for Planned Events

Natural language interface for controllers.

Examples:

> How many fleet members are required for tomorrow's concert?

> Which roads will be affected by the cricket match?

> What happens if it starts raining during the event?

> Suggest diversion plans for the festival.

Capabilities:

* Event analysis
* Scenario simulation
* Resource recommendations
* Explainable predictions

---

# Concise System Architecture

```text
                      ┌──────────────────────┐
                      │   Controller UI      │
                      └──────────┬───────────┘
                                 │
                      ┌──────────▼───────────┐
                      │   React + Vite App   │
                      └──────────┬───────────┘
                                 │
                   WebSocket (Real-Time Updates)
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
   ┌──────────▼──────────┐              ┌──────────▼──────────┐
   │   API Services      │              │   AI Chat Service   │
   │      (TS)           │              │     LangChain       │
   └──────────┬──────────┘              └──────────┬──────────┘
              │                                     │
              └──────────────┬──────────────────────┘
                             │
                  ┌──────────▼───────────┐
                  │ Ambient AI Engine    │
                  │ Congestion Engine    │
                  │ Dispatch Engine      │
                  │ Barricade Engine     │
                  └──────────┬───────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
 ┌────────▼───────┐  ┌────────▼───────┐  ┌──────▼───────┐
 │ PostgreSQL     │  │ Redis          │  │ PGVector     │
 │ Events         │  │ Cache          │  │ Embeddings   │
 │ Users          │  │ Sessions       │  │ Knowledge    │
 │ Traffic Data   │  │ Queues         │  │ Event Docs   │
 └────────┬────────┘  └────────┬───────┘  └──────────────┘
          │                   │
          │            ┌──────▼──────┐
          │            │   BullMQ    │
          │            │ Background  │
          │            │ Predictions │
          │            │ Simulations │
          │            └─────────────┘
```

---

# Tech Stack

## Frontend

* React (Vite)
* TypeScript
* WebSockets

## Backend

* TypeScript APIs
* Redis
* BullMQ

## Database

* PostgreSQL
* PGVector

## AI & Intelligence

* LangChain
* Ambient AI Engine
* Congestion Propagation Simulator
* Recommendation Engine

---

# Core Workflow

```text
Event Created
      ↓
Traffic Forecast Generated
      ↓
Congestion Propagation Simulation
      ↓
Heatmap Generation
      ↓
Barricade Recommendation
      ↓
Fleet Dispatch Recommendation
      ↓
Real-Time Monitoring
      ↓
AI Chat Assistance
      ↓
Post-Event Learning
```

---

# Vision

GridLock aims to become an AI-powered traffic command platform capable of forecasting, simulating, and mitigating event-driven congestion through intelligent recommendations and real-time decision support.
