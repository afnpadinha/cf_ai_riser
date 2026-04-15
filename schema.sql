-- ============================================================
-- MIRRORED FROM DJANGO (only fields the agent actually reads)
-- ============================================================

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    full_name     TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    preferred_language TEXT,
    status        TEXT    NOT NULL DEFAULT 'Active'
                  CHECK(status IN ('Active', 'Inactive', 'Banned')),
    -- NEW: voice preference stored here for fast single-row lookup
    voice_enabled INTEGER NOT NULL DEFAULT 0,
    voice_id      TEXT,                          -- TTS voice identifier (e.g. 'en-US-Jenny')
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE profile (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    birthday        TEXT,
    gender          TEXT CHECK(gender IN ('Male', 'Female', 'Other', 'Prefer not to say')),
    user_location   TEXT
);

CREATE TABLE client (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    motivation_level TEXT CHECK(motivation_level IN ('Low', 'Medium', 'High')), 
    plan_type        TEXT CHECK(plan_type IN ('Free', 'Premium'))
);

CREATE TABLE psychologist (
    id                INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    psychologist_type TEXT CHECK(psychologist_type IN ('peer_helper', 'licensed')),
    specialization    TEXT,
    experience_years  INTEGER NOT NULL DEFAULT 0,
    rating_avg        REAL CHECK(rating_avg >= 1.0 AND rating_avg <= 5.0) NOT NULL DEFAULT 5
);

CREATE TABLE category (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT 

);

-- ============================================================
-- NEW: Structured care plan (replaces client.goals for agent)
-- ============================================================

CREATE TABLE care_plan (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL UNIQUE REFERENCES client(user_id) ON DELETE CASCADE,
    summary           TEXT,
    focus_areas       TEXT,           -- JSON array, e.g. '["anxiety","sleep"]'
    session_frequency TEXT,           -- 'weekly', 'biweekly', etc.
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- APPOINTMENTS (mirrors session + group_participants,
-- ============================================================

CREATE TABLE appointment (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    psychologist_id INTEGER NOT NULL REFERENCES psychologist(id) ON DELETE CASCADE,
    client_id       INTEGER REFERENCES client(user_id) ON DELETE CASCADE,
    availability_id INTEGER REFERENCES psychologist_availability(id) ON DELETE SET NULL,
    session_type    TEXT    NOT NULL DEFAULT 'Individual'
                    CHECK(session_type IN ('Individual', 'Group')),
    title           TEXT    NOT NULL,
    description     TEXT,
    scheduled_at    TEXT    NOT NULL,
    duration_min    INTEGER NOT NULL,
    zoom_link       TEXT,
    category_id     INTEGER REFERENCES category(id) ON DELETE SET NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('confirmed', 'cancelled', 'pending', 'had'))

);

CREATE TABLE appointment_participant (  -- only used for Group type
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
    client_id      INTEGER NOT NULL REFERENCES client(user_id) ON DELETE CASCADE,
    UNIQUE(appointment_id, client_id)
);

CREATE TABLE psychologist_schedule (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    psychologist_id INTEGER NOT NULL REFERENCES psychologist(id) ON DELETE CASCADE,
    day_of_week     INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    start_time      TEXT NOT NULL,
    end_time        TEXT NOT NULL,
    slot_duration   REAL NOT NULL DEFAULT 45 CHECK(slot_duration >= 45 AND slot_duration <= 90)
);

CREATE TABLE psychologist_availability (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    psychologist_id INTEGER NOT NULL REFERENCES psychologist(id) ON DELETE CASCADE,
    slot            INTEGER NOT NULL REFERENCES psychologist_schedule(id) ON DELETE CASCADE,
    slot_price      INTEGER,
    is_booked       INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- NEW: AI Agent conversation sessions
--   (separate from human therapist sessions)
-- ============================================================

CREATE TABLE agent_session (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at   TEXT,
    summary    TEXT    -- written by agent at session end, read by getConversationHistory
);

CREATE TABLE session_tag (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_session_id INTEGER NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    tag              TEXT    NOT NULL,   -- situational tag, e.g. 'grief', 'work-stress'
    tagged_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- NEW: Exercise tracking
-- ============================================================

CREATE TABLE exercise_feedback (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_session_id INTEGER REFERENCES agent_session(id) ON DELETE SET NULL,
    exercise_name    TEXT    NOT NULL,
    context_tag      TEXT,   -- tag that was active when the exercise was suggested
    outcome          TEXT    NOT NULL DEFAULT 'pending'
                     CHECK(outcome IN ('pending', 'helped', 'didnt_help')),
    logged_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- NEW: Escalations
-- ============================================================

CREATE TABLE escalation (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_session_id INTEGER REFERENCES agent_session(id) ON DELETE SET NULL,
    context          TEXT    NOT NULL,
    is_urgent        INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at      TEXT,
    resolved_by      TEXT    -- name/id of human who resolved it
);

-- ============================================================
-- INDEXES for agent query patterns
-- ============================================================

CREATE INDEX idx_agent_session_user     ON agent_session(user_id, started_at DESC);
CREATE INDEX idx_session_tag_session    ON session_tag(agent_session_id);
CREATE INDEX idx_exercise_feedback_user ON exercise_feedback(user_id, logged_at DESC);
CREATE INDEX idx_exercise_feedback_outcome ON exercise_feedback(user_id, outcome);
CREATE INDEX idx_appointment_client     ON appointment(client_id, scheduled_at ASC);
CREATE INDEX idx_escalation_user        ON escalation(user_id, created_at DESC);
