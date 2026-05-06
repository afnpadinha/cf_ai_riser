# Riser — AI Wellness Companion

Riser is an AI wellness companion built for the Cloudflare Software Engineer Internship challenge. It runs on Cloudflare Workers + Durable Objects and helps users track their mental health, reflect on their week, schedule appointments with psychologists, and stay on top of exercise routines.

**Stack:** Cloudflare Workers, Durable Objects, D1 (SQLite), Workers AI (Kimi K2.5), Vercel AI SDK, React.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) v4+ — `npm install -g wrangler`
- A Cloudflare account (free tier works) — needed for Workers AI inference even in local dev

Authenticate Wrangler with your Cloudflare account before running anything:

```bash
wrangler login
```

---

## Installation

```bash
git clone <repo-url>
cd ai-riser
npm install
```

---

## Database Setup

The app uses Cloudflare D1 (SQLite). You need to apply the schema and then load the seed data. All commands below target the **local** D1 instance used by Wrangler during development.

### Step 1 — Create the local D1 database

Wrangler creates the local database automatically on first use, but you can also trigger it explicitly:

```bash
wrangler d1 execute riser-db --local --command "SELECT 1"
```

### Step 2 — Apply the schema

```bash
wrangler d1 execute riser-db --local --file=schema.sql
```

This creates all 14 tables: `users`, `profile`, `client`, `psychologist`, `category`, `care_plan`, `psychologist_schedule`, `psychologist_availability`, `appointment`, `appointment_participant`, `agent_session`, `session_tag`, `exercise_feedback`, `escalation`, and `escalation`.

### Step 3 — Populate with seed data

```bash
wrangler d1 execute riser-db --local --file=seed.sql
```

This inserts the following test data:

| What | Detail |
|---|---|
| Client | Sara Oliveira (`id=1`) — Premium plan, voice enabled |
| Psychologist | Dr. James Miller (`id=2`) — Anxiety specialist, 12 yrs experience |
| Categories | Anxiety Support, Sleep & Insomnia, Grief Support |
| Care plan | CBT-based plan targeting anxiety and sleep |
| Schedule | Dr. Miller available Monday + Wednesday 09:00–12:00 (45 min slots) |
| Availability | 2 open Monday slots, 1 Wednesday slot (already booked) |
| Appointments | 1 individual session (Wed, confirmed) + 1 group session Sara joined |
| Agent sessions | 2 past sessions with tags and summaries |
| Session tags | `anxiety_attack`, `insomnia`, `stress` |
| Exercise feedback | 4 entries — 2 helped, 1 didn't help, 1 pending |
| Escalation | 1 resolved escalation from session 1 |

### Verify the seed loaded correctly

```bash
wrangler d1 execute riser-db --local --command "SELECT id, full_name, email FROM users"
```

Expected output:

```
id  full_name         email
1   Sara Oliveira     sara.oliveira@example.com
2   Dr. James Miller  james.miller@example.com
```

---

## Running Locally

```bash
npm run dev
```

Wrangler starts a local dev server. Open [http://localhost:5173](http://localhost:5173) in your browser.

> Workers AI inference (`@cf/moonshotai/kimi-k2.5`) runs remotely against Cloudflare's network even in local dev — this is expected. You need to be logged in with `wrangler login` for this to work.

---

## Testing the App — Step by Step

The app is hardcoded to `userId = 1` (Sara Oliveira) until auth is implemented. All interactions happen as Sara.

### 1. Session startup

Open the chat and send any message (e.g. `"Hi"`). Behind the scenes the agent will:

1. Call `getUserDetails` — fetches Sara's profile, care plan, recent tags, and exercise history
2. Call `getExerciseFeedback` — checks for any pending exercises from previous sessions
3. Call `getAppointments` — fetches upcoming appointments

You should see the agent greet Sara and mention the pending exercise (`Stimulus Control Instructions`) and her upcoming appointment.

### 2. Exercise feedback follow-up

Ask the agent about the pending exercise:

```
How did the Stimulus Control Instructions go?
```

The agent should ask you to rate the outcome. Reply with something like `"it helped"` or `"it didn't help"` — the agent will call `logExerciseFeedback` to update the record.

### 3. View appointments

```
What appointments do I have coming up?
```

The agent calls `getAppointments` and should describe Sara's confirmed individual session with Dr. James Miller.

### 4. Book a new appointment

```
I'd like to book a session for anxiety support
```

The agent will:
1. Call `getCategories` to list available appointment types
2. Call `getAvailability` to find open slots with Dr. Miller
3. Propose a slot — **you will be asked to confirm before the booking is made** (this is gated with `needsApproval`)
4. On confirmation, call `bookAppointment`

### 5. Conversation history / pattern detection

```
I've been feeling anxious a lot lately and I can't sleep
```

When a recurring topic appears across sessions, the agent calls `getConversationHistory` to check how often and how recently it appeared, then responds accordingly.

### 6. Voice mode

```
I'm having a panic attack right now
```

The agent should detect the crisis signal and call `activateVoice` — this generates a calming TTS message via Workers AI (`@cf/deepgram/aura-2-en`), encodes it as base64 MP3, and broadcasts it over WebSocket. The frontend plays it and shows a pulsing "Voice active" indicator in the header.

> Note: Workers AI inference may return intermittent `8004: Internal server error` on the AI side. If voice playback fails, this is a Cloudflare-side issue, not a code bug.

### 7. End the session

```
I'm done for today, thanks
```

The agent should call `tagConversation` (writes topic tags to `session_tag`) and then `endsConversation` (saves a session summary).

### 8. Escalation

If you mention something like:

```
I've been having thoughts of hurting myself
```

The agent should immediately call `escalate`, which inserts a row into the `escalation` table with `is_urgent = 1`, and advise Sara to contact professional help.

---

## Resetting the Database

To wipe local data and start fresh:

```bash
# Re-apply the schema (drops and recreates all tables)
wrangler d1 execute riser-db --local --file=schema.sql

# Re-seed
wrangler d1 execute riser-db --local --file=seed.sql
```

---

## Deploying to Cloudflare

### Create the D1 database on Cloudflare (first time only)

```bash
wrangler d1 create riser-db
```

Copy the `database_id` from the output and confirm it matches the one in `wrangler.jsonc`.

### Apply schema and seed to the remote database

```bash
wrangler d1 execute riser-db --remote --file=schema.sql
wrangler d1 execute riser-db --remote --file=seed.sql
```

### Deploy the Worker

```bash
npm run deploy
```

Your agent will be live at `https://ai-riser.<your-subdomain>.workers.dev`.

---

## Project Structure

```
ai-riser/
├── src/
│   ├── server.ts       # Durable Object agent — all tools, DB queries, TTS
│   ├── app.tsx         # React frontend — chat UI, voice playback
│   ├── client.tsx      # React entry point
│   ├── prompt.ts       # System prompt defining Riser's identity and rules
│   └── styles.css
├── schema.sql          # D1 database schema (14 tables)
├── seed.sql            # Test data (Sara Oliveira + Dr. James Miller)
├── wrangler.jsonc      # Cloudflare config (D1 binding, AI binding)
└── env.d.ts            # TypeScript env types
```

---

## Known Issues

- **Voice playback** (`NotSupportedError`): TTS audio may fail to play in the browser. The binary encoding on the server side may still produce invalid data in some cases, and Cloudflare Workers AI inference is intermittently returning `8004: Internal server error`.
- **`endsConversation` tool**: currently does not save a summary — the `summary` field is missing from its input schema. The session `summary` column in D1 will remain `NULL`.
- **Auth**: `userId` is hardcoded to `1` (Sara Oliveira). All sessions run as Sara until Cloudflare Access or another auth mechanism is wired up.
