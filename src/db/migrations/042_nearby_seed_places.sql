-- Seed initial places hierarchy (US states + major cities)

-- Country
INSERT INTO nearby_places (place_id, name, place_type, parent_place_id, lat, lng) VALUES
('us', 'United States', 'country', NULL, 39.8283, -98.5795)
ON CONFLICT (place_id) DO NOTHING;

-- States
INSERT INTO nearby_places (place_id, name, place_type, parent_place_id, lat, lng) VALUES
('illinois', 'Illinois', 'state', 'us', 40.6331, -89.3985),
('new_york_state', 'New York', 'state', 'us', 42.1657, -74.9481),
('california', 'California', 'state', 'us', 36.7783, -119.4179),
('texas', 'Texas', 'state', 'us', 31.9686, -99.9018),
('florida', 'Florida', 'state', 'us', 27.6648, -81.5158),
('massachusetts', 'Massachusetts', 'state', 'us', 42.4072, -71.3824),
('pennsylvania', 'Pennsylvania', 'state', 'us', 41.2033, -77.1945),
('dc', 'District of Columbia', 'state', 'us', 38.9072, -77.0369),
('georgia', 'Georgia', 'state', 'us', 33.0406, -83.6431),
('ohio', 'Ohio', 'state', 'us', 40.4173, -82.9071),
('michigan', 'Michigan', 'state', 'us', 44.3148, -85.6024),
('minnesota', 'Minnesota', 'state', 'us', 46.7296, -94.6859),
('colorado', 'Colorado', 'state', 'us', 39.5501, -105.7821),
('oregon', 'Oregon', 'state', 'us', 43.8041, -120.5542),
('washington', 'Washington', 'state', 'us', 47.7511, -120.7401),
('connecticut', 'Connecticut', 'state', 'us', 41.5978, -72.7554)
ON CONFLICT (place_id) DO NOTHING;

-- Cities
INSERT INTO nearby_places (place_id, name, place_type, parent_place_id, lat, lng) VALUES
('chicago_il', 'Chicago, IL', 'city', 'illinois', 41.8781, -87.6298),
('new_york_ny', 'New York, NY', 'city', 'new_york_state', 40.7128, -74.0060),
('los_angeles_ca', 'Los Angeles, CA', 'city', 'california', 34.0522, -118.2437),
('san_francisco_ca', 'San Francisco, CA', 'city', 'california', 37.7749, -122.4194),
('washington_dc', 'Washington, DC', 'city', 'dc', 38.9072, -77.0369),
('boston_ma', 'Boston, MA', 'city', 'massachusetts', 42.3601, -71.0589),
('philadelphia_pa', 'Philadelphia, PA', 'city', 'pennsylvania', 39.9526, -75.1652),
('atlanta_ga', 'Atlanta, GA', 'city', 'georgia', 33.7490, -84.3880),
('austin_tx', 'Austin, TX', 'city', 'texas', 30.2672, -97.7431),
('houston_tx', 'Houston, TX', 'city', 'texas', 29.7604, -95.3698),
('dallas_tx', 'Dallas, TX', 'city', 'texas', 32.7767, -96.7970),
('denver_co', 'Denver, CO', 'city', 'colorado', 39.7392, -104.9903),
('miami_fl', 'Miami, FL', 'city', 'florida', 25.7617, -80.1918),
('detroit_mi', 'Detroit, MI', 'city', 'michigan', 42.3314, -83.0458),
('minneapolis_mn', 'Minneapolis, MN', 'city', 'minnesota', 44.9778, -93.2650),
('portland_or', 'Portland, OR', 'city', 'oregon', 45.5152, -122.6784),
('seattle_wa', 'Seattle, WA', 'city', 'washington', 47.6062, -122.3321),
('cleveland_oh', 'Cleveland, OH', 'city', 'ohio', 41.4993, -81.6944),
('new_haven_ct', 'New Haven, CT', 'city', 'connecticut', 41.3083, -72.9279),
('grand_rapids_mi', 'Grand Rapids, MI', 'city', 'michigan', 42.9634, -85.6681)
ON CONFLICT (place_id) DO NOTHING;
