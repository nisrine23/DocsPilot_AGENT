CREATE TABLE IF NOT EXISTS pump_extractions (
    id                SERIAL PRIMARY KEY,
    tag_name          TEXT UNIQUE NOT NULL,
    client_name       TEXT,
    flow_value        DOUBLE PRECISION,
    head_value        DOUBLE PRECISION,
    existing_pump     TEXT,
    marque_roulement  TEXT,
    marque_garniture  TEXT,
    full_json         JSONB NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);