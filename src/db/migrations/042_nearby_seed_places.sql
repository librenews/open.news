-- Seed initial places hierarchy
-- US states first, then cities

-- Countries
INSERT INTO nearby_places (place_id, name, place_type, parent_place_id, lat, lng, geom) VALUES
('us', 'United States', 'country', NULL, 39.8283, -98.5795, ST_MakePoint(-98.5795, 39.8283)::geography)
ON CONFLICT (place_id) DO NOTHING;

-- States
INSERT INTO nearby_places (place_id, name, place_type, parent_place_id, lat, lng, geom) VALUES
('illinois', 'Illinois', 'state', 'us', 40.6331, -89.3985, ST_MakePoint(-89.3985, 40.6331)::geography),
('new_york_state', 'New York', 'state', 'us', 42.1657, -74.9481, ST_MakePoint(-74.9481, 42.1657)::geography),
('california', 'California', 'state', 'us', 36.7783, -119.4179, ST_MakePoint(-119.4179, 36.7783)::geography),
('texas', 'Texas', 'state', 'us', 31.9686, -99.9018, ST_MakePoint(-99.9018, 31.9686)::geography),
('florida', 'Florida', 'state', 'us', 27.6648, -81.5158, ST_MakePoint(-81.5158, 27.6648)::geography),
('massachusetts', 'Massachusetts', 'state', 'us', 42.4072, -71.3824, ST_MakePoint(-71.3824, 42.4072)::geography),
('pennsylvania', 'Pennsylvania', 'state', 'us', 41.2033, -77.1945, ST_MakePoint(-77.1945, 41.2033)::geography),
('dc', 'District of Columbia', 'state', 'us', 38.9072, -77.0369, ST_MakePoint(-77.0369, 38.9072)::geography),
('georgia', 'Georgia', 'state', 'us', 33.0406, -83.6431, ST_MakePoint(-83.6431, 33.0406)::geography),
('ohio', 'Ohio', 'state', 'us', 40.4173, -82.9071, ST_MakePoint(-82.9071, 40.4173)::geography),
('michigan', 'Michigan', 'state', 'us', 44.3148, -85.6024, ST_MakePoint(-85.6024, 44.3148)::geography),
('minnesota', 'Minnesota', 'state', 'us', 46.7296, -94.6859, ST_MakePoint(-94.6859, 46.7296)::geography),
('colorado', 'Colorado', 'state', 'us', 39.5501, -105.7821, ST_MakePoint(-105.7821, 39.5501)::geography),
('oregon', 'Oregon', 'state', 'us', 43.8041, -120.5542, ST_MakePoint(-120.5542, 43.8041)::geography),
('washington', 'Washington', 'state', 'us', 47.7511, -120.7401, ST_MakePoint(-120.7401, 47.7511)::geography),
('connecticut', 'Connecticut', 'state', 'us', 41.5978, -72.7554, ST_MakePoint(-72.7554, 41.5978)::geography)
ON CONFLICT (place_id) DO NOTHING;

-- Cities
INSERT INTO nearby_places (place_id, name, place_type, parent_place_id, lat, lng, geom) VALUES
('chicago_il', 'Chicago, IL', 'city', 'illinois', 41.8781, -87.6298, ST_MakePoint(-87.6298, 41.8781)::geography),
('new_york_ny', 'New York, NY', 'city', 'new_york_state', 40.7128, -74.0060, ST_MakePoint(-74.0060, 40.7128)::geography),
('los_angeles_ca', 'Los Angeles, CA', 'city', 'california', 34.0522, -118.2437, ST_MakePoint(-118.2437, 34.0522)::geography),
('san_francisco_ca', 'San Francisco, CA', 'city', 'california', 37.7749, -122.4194, ST_MakePoint(-122.4194, 37.7749)::geography),
('washington_dc', 'Washington, DC', 'city', 'dc', 38.9072, -77.0369, ST_MakePoint(-77.0369, 38.9072)::geography),
('boston_ma', 'Boston, MA', 'city', 'massachusetts', 42.3601, -71.0589, ST_MakePoint(-71.0589, 42.3601)::geography),
('philadelphia_pa', 'Philadelphia, PA', 'city', 'pennsylvania', 39.9526, -75.1652, ST_MakePoint(-75.1652, 39.9526)::geography),
('atlanta_ga', 'Atlanta, GA', 'city', 'georgia', 33.7490, -84.3880, ST_MakePoint(-84.3880, 33.7490)::geography),
('austin_tx', 'Austin, TX', 'city', 'texas', 30.2672, -97.7431, ST_MakePoint(-97.7431, 30.2672)::geography),
('houston_tx', 'Houston, TX', 'city', 'texas', 29.7604, -95.3698, ST_MakePoint(-95.3698, 29.7604)::geography),
('dallas_tx', 'Dallas, TX', 'city', 'texas', 32.7767, -96.7970, ST_MakePoint(-96.7970, 32.7767)::geography),
('denver_co', 'Denver, CO', 'city', 'colorado', 39.7392, -104.9903, ST_MakePoint(-104.9903, 39.7392)::geography),
('miami_fl', 'Miami, FL', 'city', 'florida', 25.7617, -80.1918, ST_MakePoint(-80.1918, 25.7617)::geography),
('detroit_mi', 'Detroit, MI', 'city', 'michigan', 42.3314, -83.0458, ST_MakePoint(-83.0458, 42.3314)::geography),
('minneapolis_mn', 'Minneapolis, MN', 'city', 'minnesota', 44.9778, -93.2650, ST_MakePoint(-93.2650, 44.9778)::geography),
('portland_or', 'Portland, OR', 'city', 'oregon', 45.5152, -122.6784, ST_MakePoint(-122.6784, 45.5152)::geography),
('seattle_wa', 'Seattle, WA', 'city', 'washington', 47.6062, -122.3321, ST_MakePoint(-122.3321, 47.6062)::geography),
('cleveland_oh', 'Cleveland, OH', 'city', 'ohio', 41.4993, -81.6944, ST_MakePoint(-81.6944, 41.4993)::geography),
('new_haven_ct', 'New Haven, CT', 'city', 'connecticut', 41.3083, -72.9279, ST_MakePoint(-72.9279, 41.3083)::geography)
ON CONFLICT (place_id) DO NOTHING;
