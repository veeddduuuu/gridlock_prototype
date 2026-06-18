-- Fleet inventory (controllers + fleet personnel)
CREATE TABLE IF NOT EXISTS users (
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

-- Fleet personnel assigned to specific junctions for a given event
CREATE TABLE IF NOT EXISTS fleet_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    junction_name VARCHAR(255) NOT NULL,
    role VARCHAR(100) NOT NULL,
    deploy_by_time TIMESTAMP,
    priority VARCHAR(50) DEFAULT 'Medium',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'en_route', 'on_site', 'completed', 'blocked')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_fleet_assignments_updated_at ON fleet_assignments;

CREATE TRIGGER update_fleet_assignments_updated_at
BEFORE UPDATE ON fleet_assignments
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Recommendation metadata on events
ALTER TABLE events
ADD COLUMN IF NOT EXISTS recommendation_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS recommendation_rationale TEXT,
ADD COLUMN IF NOT EXISTS total_fleet_required INTEGER DEFAULT 0;

-- Seed fleet personnel near a spread of junctions so the dispatch engine has
-- something to recommend against in the demo.
INSERT INTO users (email, role, name, status, current_lat, current_lon)
VALUES
    ('fleet1@gridlock.demo', 'fleet', 'Arjun Rao', 'available', 13.017761, 77.556973),
    ('fleet2@gridlock.demo', 'fleet', 'Vikram Shetty', 'available', 13.040089, 77.518302),
    ('fleet3@gridlock.demo', 'fleet', 'Deepak Kumar', 'available', 12.976696, 77.586048),
    ('fleet4@gridlock.demo', 'fleet', 'Suresh Babu', 'available', 12.917013, 77.622874),
    ('fleet5@gridlock.demo', 'fleet', 'Manjunath Gowda', 'available', 12.954126, 77.543464),
    ('fleet6@gridlock.demo', 'fleet', 'Ravi Kiran', 'available', 13.042259, 77.590922),
    ('fleet7@gridlock.demo', 'fleet', 'Praveen Nair', 'available', 12.991387, 77.657421),
    ('fleet8@gridlock.demo', 'fleet', 'Naveen Reddy', 'available', 12.967817, 77.590309),
    ('fleet9@gridlock.demo', 'fleet', 'Karthik Iyer', 'available', 13.094322, 77.595927),
    ('fleet10@gridlock.demo', 'fleet', 'Santosh Patil', 'available', 12.923716, 77.618662),
    ('controller1@gridlock.demo', 'controller', 'Priya Menon', 'available', NULL, NULL)
ON CONFLICT (email) DO NOTHING;
