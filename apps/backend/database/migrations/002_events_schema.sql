-- Create UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create events table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL, -- 'planned', 'unplanned'
    category VARCHAR(50) NOT NULL, -- 'public_event', 'vehicle_breakdown', etc.
    name TEXT,
    description TEXT,
    lat FLOAT NOT NULL,
    lon FLOAT NOT NULL,
    expected_crowd_size INT,
    start_datetime TIMESTAMP NOT NULL,
    expected_end_datetime TIMESTAMP,
    closed_datetime TIMESTAMP,
    affected_corridors TEXT[],
    requires_road_closure BOOLEAN DEFAULT FALSE,
    veh_type VARCHAR(50),
    priority VARCHAR(50),
    duration_mins INT,
    severity_score NUMERIC(5, 2),
    status VARCHAR(50) DEFAULT 'created', -- 'created', 'active', 'monitoring', 'closed', 'reported'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_events_updated_at ON events;

CREATE TRIGGER update_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
