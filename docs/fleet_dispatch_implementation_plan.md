# Fleet Dispatch Engine — End-to-End Implementation Plan

Based on the feature requirements in `gridlock_feature_list.md` and current project structure, here is the complete plan for building the Fleet Dispatch and Recommendation Engine.

## Phase 1: Database Schema Enhancements

To support fleet state and recommendations, we need to introduce new tables and extend existing ones.

### 1. `users` Table (Fleet Inventory)
Stores the fleet personnel, their current real-time locations, and their availability.
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('controller', 'fleet')),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'available' CHECK (status IN ('available', 'dispatched', 'on_site', 'off_duty')),
    current_lat DOUBLE PRECISION,
    current_lon DOUBLE PRECISION,
    last_location_update TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 2. `fleet_assignments` Table
Maps the specific tasks assigned to fleet personnel by the controller.
```sql
CREATE TABLE fleet_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    junction_name VARCHAR(255) NOT NULL,
    role VARCHAR(100) NOT NULL, -- e.g., 'traffic_direction', 'incident_clearance'
    deploy_by_time TIMESTAMP,
    priority VARCHAR(50) DEFAULT 'Medium',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'en_route', 'on_site', 'completed', 'blocked')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Extend `events` Table
We need to capture recommendation data directly or store a structured JSON response to avoid recalculating the plan unless necessary.
```sql
ALTER TABLE events 
ADD COLUMN recommendation_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN recommendation_rationale TEXT,
ADD COLUMN total_fleet_required INTEGER DEFAULT 0;
```

---

## Phase 2: Building the Recommendation Context Aggregator

The LLM needs specific context to make intelligent dispatch decisions. We will create a `RecommendationService` that gathers this data before calling the LLM.

### 1. Active Congestion Forecast (Simulation Fast-Forward)
In `services/simulation.service.ts`, add a method to perform a rapid "in-memory" fast-forward of the propagation engine without broadcasting.
```typescript
// simulation.service.ts
export const getCongestionForecast = async (seedLat, seedLon, severity, duration) => {
    // Run propagation algorithm in a pure function up to T+15 and T+30
    return {
        t0_nodes: [/* initial nodes */],
        t15_nodes: [/* predicted nodes at +15m */],
        t30_nodes: [/* predicted nodes at +30m */]
    }
}
```

### 2. Historical Precedents (Fingerprinting)
Call the ML fingerprinting service (to be built or mocked) to get similar historical events to understand secondary incident risk.
```typescript
const precedents = await callMLFingerprint({ lat, lon, type, hour });
```

### 3. Fleet Inventory State
Fetch all available fleet personnel and their coordinates from the `users` table.
```typescript
const availableFleet = await query("SELECT id, name, current_lat, current_lon FROM users WHERE status = 'available' AND role = 'fleet'");
```

---

## Phase 3: Event Controller Modifications (`events.controller.ts`)

Currently, event creation ends after scheduling the propagation job. We need to insert the recommendation pipeline into the lifecycle.

**Refactored Lifecycle in `createEvent`:**
1. Insert Event into DB.
2. Call ML Predict for Duration/Severity (Existing).
3. **NEW:** Call Fingerprinting for Precedents.
4. **NEW:** Generate Congestion Forecast (T+0, T+15, T+30).
5. **NEW:** Fetch Available Fleet.
6. **NEW:** Call `RecommendationService.generateDispatchPlan(context)`.
7. **NEW:** Parse LLM output and insert pending records into `fleet_assignments`.
8. Schedule Propagation Job (Existing).
9. Broadcast `event:created` AND `recommendations:generated` via WebSocket.

*Note: Since the LLM call might take a few seconds, it's advisable to do steps 3-7 asynchronously. We can return `201 Created` early with `recommendation_status = 'processing'` and then broadcast the recommendations later.*

---

## Phase 4: LLM Service Integration

Create `services/recommendation.service.ts` to interface with Anthropic Claude API or OpenAI API.

**Prompt Design:**
```text
You are the AI Command Center for GridLock (Bengaluru Traffic Management).
An event has been reported: {event.type} at {event.lat}, {event.lon}.
Predicted Duration: {ml.duration} mins | Severity: {ml.severity}.

Historical Precedent: {precedents.summary}
Active Nodes Expected:
- T+0: {forecast.t0}
- T+15: {forecast.t15}
- T+30: {forecast.t30}

Available Fleet Inventory: {availableFleet}

Generate an actionable dispatch plan assigning fleet personnel to specific junctions.
Respond strictly in JSON format matching this schema:
{
  "total_fleet_required": number,
  "rationale": "string",
  "deployments": [
    { "junction": string, "fleet_count": number, "role": string, "deploy_by_mins": number, "priority": string }
  ]
}
```

---

## Phase 5: Real-Time Communication & Conflict Detection

### WebSocket Broadcasting
When recommendations are generated or accepted, the `events.controller.ts` should publish WebSocket events:
- `recommendations:ready`: Tells the dashboard to display the new recommendation cards.
- `fleet:dispatched`: Notifies specific fleet mobile clients that they have a new task.

### Multi-Event Conflict Check
During step 6 (Recommendation Generation), if another event is active in the vicinity, flag a conflict:
```typescript
const activeEvents = await query("SELECT * FROM events WHERE status = 'active'");
const isConflict = checkSpatialTemporalOverlap(newEvent, activeEvents);
if (isConflict) {
    // Generate Conflict Alert Payload
}
```

---

## 🚀 Out of Scope Improvisations (Bonus Features)

To make the prototype more robust, we can add the following features that go slightly beyond the original feature list:

1. **Equipment & Capabilities Tracking:**
   Instead of just treating all fleet members equally, add a `capabilities` array to the `users` table (e.g., `['tow_truck', 'heavy_barricades', 'medical_training']`). The LLM prompt can then assign the *right* personnel (e.g., dispatching a tow truck specifically to an accident).

2. **Geo-Fenced Auto-Status Updates:**
   On the mobile frontend, continuously track the fleet member's GPS. If their distance to the assigned `junction_lat_lon` drops below 100 meters, automatically trigger an API call to change their status from `en_route` to `on_site`. This removes manual friction for the worker.

3. **Fatigue & Shift Balancing:**
   Pass the `last_assignment_completed_at` timestamp to the LLM. The LLM can be instructed to prioritize fleet members who haven't been dispatched recently, ensuring a balanced workload.

4. **Dynamic Rerouting Integration:**
   Have the Barricade Recommendation Engine output "Recommended Diversion Paths" (e.g., "Divert traffic via Old Madras Road"). We could visually render these diversion arrows on the Leaflet map so the controller sees exactly how traffic will flow after placing a barricade.
