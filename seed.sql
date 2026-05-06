-- ============================================================
-- SEED DATA — Wellness AI Agent
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================

INSERT INTO users (id, username, full_name, email, preferred_language, status, voice_enabled, voice_id, created_at)
VALUES
    (1, 'sara.oliveira', 'Sara Oliveira',    'sara.oliveira@example.com', 'en', 'Active', 1, 'en-US-Jenny', '2026-01-10 09:00:00'),
    (2, 'dr.james.miller', 'Dr. James Miller', 'james.miller@example.com', 'en', 'Active', 0, NULL,          '2026-01-08 08:00:00');

-- ============================================================
-- PROFILES
-- ============================================================

INSERT INTO profile (user_id, birthday, gender, user_location)
VALUES
    (1, '1995-06-14', 'Female', 'Lisbon, Portugal'),
    (2, '1978-03-22', 'Male',   'London, UK');

-- ============================================================
-- CLIENT
-- ============================================================

INSERT INTO client (user_id, motivation_level, plan_type)
VALUES (1, 'Medium', 'Premium');

-- ============================================================
-- PSYCHOLOGIST
-- ============================================================

INSERT INTO psychologist (id, psychologist_type, specialization, experience_years, rating_avg)
VALUES (2, 'licensed', 'Anxiety', 12, 4.8);

-- ============================================================
-- CATEGORIES
-- ============================================================

INSERT INTO category (id, name, description)
VALUES
    (1, 'Anxiety Support',   'Tools and sessions focused on managing anxiety, panic attacks, and worry.'),
    (2, 'Sleep & Insomnia',  'Evidence-based approaches for improving sleep quality and treating insomnia.'),
    (3, 'Grief Support',     'Compassionate support for navigating loss and the grieving process.');

-- ============================================================
-- CARE PLAN
-- ============================================================

INSERT INTO care_plan (client_id, summary, focus_areas, session_frequency, updated_at)
VALUES (
    1,
    'Sara presents with generalised anxiety and persistent sleep difficulties. The plan targets cognitive restructuring for anxious thoughts and sleep hygiene improvement through CBT-based techniques.',
    '["anxiety","sleep"]',
    'weekly',
    '2026-02-01 10:00:00'
);

-- ============================================================
-- PSYCHOLOGIST SCHEDULE  (Monday=0, Wednesday=2)
-- ============================================================

INSERT INTO psychologist_schedule (id, psychologist_id, day_of_week, start_time, end_time, slot_duration)
VALUES
    (1, 2, 1, '09:00', '12:00', 45),   -- Monday
    (2, 2, 3, '09:00', '12:00', 45);   -- Wednesday

-- ============================================================
-- PSYCHOLOGIST AVAILABILITY
--   slot 1 (Mon) × 2 unbooked, slot 2 (Wed) × 1 booked
-- ============================================================

INSERT INTO psychologist_availability (id, psychologist_id, slot, slot_price, is_booked)
VALUES
    (1, 2, 1, 60, 0),   -- Monday 09:00 — available
    (2, 2, 1, 60, 0),   -- Monday 09:45 — available
    (3, 2, 2, 60, 1);   -- Wednesday 09:00 — booked

-- ============================================================
-- APPOINTMENTS
-- ============================================================

-- Individual upcoming appointment (Wed slot, booked availability id=3)
INSERT INTO appointment (id, psychologist_id, client_id, availability_id, session_type, title, description, scheduled_at, duration_min, zoom_link, category_id, status, created_at)
VALUES (
    1,
    2, 1, 3,
    'Individual',
    'Weekly Check-in: Anxiety & Sleep',
    'Follow-up on CBT homework and sleep diary review.',
    '2026-04-23 09:00:00',
    45,
    'https://zoom.us/j/example-individual-001',
    1,
    'confirmed',
    '2026-04-15 11:00:00'
);

-- Group appointment (no client_id — participants listed in appointment_participant)
INSERT INTO appointment (id, psychologist_id, client_id, availability_id, session_type, title, description, scheduled_at, duration_min, zoom_link, category_id, status, created_at)
VALUES (
    2,
    2, NULL, NULL,
    'Group',
    'Anxiety Support Group — April Session',
    'Open group session for members working through generalised anxiety.',
    '2026-04-25 18:00:00',
    60,
    'https://zoom.us/j/example-group-002',
    1,
    'confirmed',
    '2026-04-10 14:00:00'
);

-- ============================================================
-- APPOINTMENT PARTICIPANTS  (Sara joins the group session)
-- ============================================================

INSERT INTO appointment_participant (appointment_id, client_id)
VALUES (2, 1);

-- ============================================================
-- AGENT SESSIONS  (2 past sessions for Sara)
-- ============================================================

INSERT INTO agent_session (id, user_id, started_at, ended_at, summary)
VALUES
    (
        1, 1,
        '2026-04-10 20:05:00',
        '2026-04-10 20:38:00',
        'Sara reported a moderate anxiety episode triggered by a work presentation. We explored the physical symptoms (racing heart, shallow breathing) and practised a 4-7-8 breathing exercise. She rated her anxiety 7/10 at start and 4/10 at close. Sleep was disrupted the previous night; recommended a wind-down routine and limiting screens after 22:00.'
    ),
    (
        2, 1,
        '2026-04-14 21:10:00',
        '2026-04-14 21:45:00',
        'Sara described persistent difficulty falling asleep (>45 min onset). Sleep diary shows inconsistent wake times. Introduced stimulus control instructions and a brief progressive muscle relaxation exercise. She also mentioned ongoing low-level stress from a family conflict. Tagged for follow-up on insomnia and stress. No safety concerns.'
    );

-- ============================================================
-- SESSION TAGS
-- ============================================================

INSERT INTO session_tag (agent_session_id, tag)
VALUES
    (1, 'anxiety_attack'),
    (2, 'insomnia'),
    (2, 'stress');

-- ============================================================
-- EXERCISE FEEDBACK
-- ============================================================

INSERT INTO exercise_feedback (user_id, agent_session_id, exercise_name, context_tag, outcome, logged_at)
VALUES
    (1, 1, '4-7-8 Breathing',                'anxiety_attack', 'helped',      '2026-04-11 09:15:00'),
    (1, 1, 'Grounding (5-4-3-2-1)',           'anxiety_attack', 'helped',      '2026-04-12 08:40:00'),
    (1, 2, 'Progressive Muscle Relaxation',   'insomnia',       'didnt_help',  '2026-04-15 07:30:00'),
    (1, 2, 'Stimulus Control Instructions',   'insomnia',       'pending',     '2026-04-14 21:45:00');

-- ============================================================
-- ESCALATION
-- ============================================================

INSERT INTO escalation (user_id, agent_session_id, context, is_urgent, created_at, resolved_at, resolved_by)
VALUES (
    1, 1,
    'During session on 2026-04-10 Sara mentioned feeling overwhelmed and described occasional thoughts of wanting to "disappear". Agent flagged for human review. No active suicidal ideation confirmed but situation warranted escalation per protocol.',
    1,
    '2026-04-10 20:38:00',
    '2026-04-11 10:05:00',
    'Dr. James Miller'
);