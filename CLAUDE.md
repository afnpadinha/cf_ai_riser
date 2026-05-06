# Riser — AI Wellness Companion

## What Is Riser

Riser is an AI wellness companion built for the Cloudflare Software Engineer Internship challenge. It lives on Cloudflare Workers + Durable Objects and talks to users through a chat interface, helping them track their mental health, reflect on their week, schedule appointments with psychologists, and stay on top of their exercise routines.

The AI is not a therapist — it's a companion. It notices patterns, asks questions, keeps track of what users share over time, and knows when to suggest professional help.

Stack: Cloudflare Workers, Durable Objects, D1 (SQLite), Workers AI (Kimi K2.5), Vercel AI SDK, React.

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
├── env.d.ts            # TypeScript env types
└── PROMPTS.md          # Notes and prompt drafts
```

---

## Database Schema (schema.sql)

14 tables. Key ones:

| Table | Purpose |
|---|---|
| `users` | All accounts (both clients and psychologists share this table) |
| `client` | Client-specific data — `user_id` is PK and FK to `users` |
| `psychologist` | Psychologist data — `id` is PK and FK to `users` |
| `appointment` | Individual or group sessions — `client_id` nullable for groups |
| `category` | Types of appointments (grief, anxiety, addiction, etc.) |
| `psychologist_schedule` | Weekly recurring availability windows |
| `psychologist_availability` | Specific available slots (references `psychologist_schedule`) |
| `agent_session` | One row per chat session — stores `started_at`, `ended_at`, `summary` |
| `session_tag` | Tags applied to sessions (anxiety, insomnia, stress, etc.) |
| `exercise_feedback` | Logs of exercises suggested — tracks outcome (pending/helped/didnt_help) |
| `care_plan` | Active wellness plans assigned to a client |
| `escalation` | Flagged sessions requiring urgent human review |

---

## Agent Tools (src/server.ts)

The agent class is `ChatAgent extends AIChatAgent<Env>`. All tools are defined **inline inside `onChatMessage`**, not in a separate `getTools()` method.

### Class properties

```typescript
export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  userId!: number;   // set in onStart() — hardcoded to 1 until auth is implemented
  agentId!: number;  // set in onStart() — the current agent_session row ID
}
```

`onStart()` inserts a row into `agent_session` and stores the returned `last_row_id` as `this.agentId`.

### Tool inventory

| Tool | Status | What it does |
|---|---|---|
| `tagConversation` | Done | Classifies the conversation with topic tags, writes to `session_tag`. Uses `Promise.all` + `map`. |
| `endsConversation` | Bug | Should save a summary to `agent_session`. Description says it does, but inputSchema only accepts `tags` — no `summary` field exists. Currently just inserts tags (same as `tagConversation`). |
| `getUserDetails` | Done | Fetches user profile, care plan, recent session tags, and exercise history. Note: tool description mentions voice preference but the SQL query does not select it. |
| `getConversationHistory` | Done | Fetches full dated history grouped by tag. Used for density/window pattern analysis. Different from `getUserDetails` which only returns a broad tag overview. |
| `getAppointments` | Needs fix | Returns upcoming appointments. Missing `ap.id` in SELECT — model needs the ID to reference specific bookings. |
| `getCategories` | Done | Returns all appointment categories and psychologist specialisations. |
| `getAvailability` | Needs fix | Individual session path uses `.first()` — should be `.all()` to return multiple available slots. |
| `bookAppointment` | Done | Books a slot. `needsApproval: async () => true` — user must confirm before it executes. |
| `getExerciseFeedback` | Done | Returns pending exercises (for session start follow-up) and resolved exercise outcomes grouped by tag. |
| `logExerciseFeedback` | Needs fix | Saves or updates exercise outcome. Second branch uses `=== null` to check `exercise_id` — should be `== null` to also catch `undefined` (the field is `.optional()` in Zod, not `.nullable()`). |
| `escalate` | Done | Inserts a row into `escalation` with `is_urgent = 1`. Flags session for urgent human review. |
| `activateVoice` | Done (server) | Calls `@cf/deepgram/aura-2-en` via Workers AI, base64-encodes the result, broadcasts `{ type: "voice-audio", audio: base64 }` over WebSocket. Frontend side not yet implemented. |
| `deactivateVoice` | Done (server) | Broadcasts `{ type: "voice-deactivate" }`. Frontend side not yet implemented. |

---

## Valid Conversation Tags (TAGS constant in server.ts)

```typescript
const TAGS = [
  "stress", "burnout", "insomnia", "loneliness",
  "panic_attack", "anxiety_attack", "sobriety_doubt", "substance_abuse",
  "grief", "relationship", "academic_pressure", "general_support"
] as const
```

**Important:** `work_pressure` appears in `prompt.ts` but is NOT in this constant. The Zod schema will reject it at runtime. Either add it to `TAGS` in `server.ts`, or remove it from the prompt.

---

## System Prompt (src/prompt.ts)

Rewritten this session. Now covers:

- Riser's identity and tone
- Session startup protocol: call `getUserDetails` → `getExerciseFeedback` → `getAppointments` silently at the start of every session, in that order
- Tool reference section: when to call each tool and why
- Exercise feedback loop: log as `pending` when suggested, update with `exercise_id` when user reports back
- Pattern detection: call `getConversationHistory` when a recurring topic appears, apply density/window logic
- Voice mode: `activateVoice` during panic/overwhelm, `deactivateVoice` once calm
- Booking flow: `getCategories` → `getAvailability` → `bookAppointment`, gated by `plan_type`
- Escalation: `escalate` immediately on crisis signals (separate from booking)
- Session end: `tagConversation` then `endsConversation`, always in that order

**Known issue in prompt:** `activateVoice` section does not tell the model what to pass for the `voice` parameter. `getUserDetails` is supposed to return a voice preference but the SQL query doesn't select one. Needs a fallback instruction (e.g. use a default voice if none is available).

---

## Voice (TTS)

Flow:
1. Model calls `activateVoice` with `text` (the calming message to speak) and `voice` (speaker name)
2. `this.env.AI.run('@cf/deepgram/aura-2-en')` generates MP3 audio
3. Audio is base64-encoded with `btoa(audio)`
4. Broadcast to frontend: `this.broadcast(JSON.stringify({ type: "voice-audio", audio: base64 }))`
5. Frontend receives it in the `onMessage` WebSocket handler
6. Frontend creates a data URI: `"data:audio/mp3;base64," + data.audio` and plays it with `new Audio(dataUri).play()`
7. Frontend stores the `Audio` instance in a `useRef` so it can be paused when `voice-deactivate` arrives

**Frontend voice handling is not yet implemented in `app.tsx`.** The `onMessage` handler has a placeholder comment where the handler should go.

---

## What Has Been Done

- [x] D1 schema designed and applied
- [x] Seed data written and loaded
- [x] All major agent tools implemented
- [x] Pattern detection logic designed (density vs persistence)
- [x] TTS voice integration implemented (server side)
- [x] `bookAppointment` has `needsApproval` gate
- [x] `onStart()` creates an `agent_session` row
- [x] System prompt fully rewritten — identity, tool reference, session startup, exercise loop, booking flow, escalation, session end

---

## What Still Needs Doing

### Fixes (server.ts)
- [ ] `endsConversation`: add `summary: z.string()` to inputSchema and write it to `agent_session.summary` via UPDATE
- [ ] `getAppointments`: add `ap.id` to SELECT
- [ ] `getAvailability`: individual path `.first()` → `.all()`
- [ ] `logExerciseFeedback`: `=== null` → `== null` on the `exercise_id` check
- [ ] `TAGS` constant: add `"work_pressure"` (or remove it from `prompt.ts`)
- [ ] `getUserDetails`: SQL query does not select a voice preference — either add it to the DB/query or remove the mention from the tool description
- [ ] Remove unused imports (`type Schedule`, `stepCountIs`)

### Frontend (app.tsx)
- [ ] Handle `voice-audio` broadcast: build data URI from base64, play with `new Audio()`, store instance in `useRef`, set `isVoiceActive` state to `true`
- [ ] Handle `voice-deactivate` broadcast: call `.pause()` on the ref, clear it, set `isVoiceActive` to `false`
- [ ] Add a visible UI indicator when voice mode is active

### Prompt (prompt.ts)
- [ ] Add fallback instruction for `activateVoice` `voice` parameter (default voice when no preference is available)
- [ ] Fix `work_pressure` tag (sync with server or remove)

### Auth
- [ ] `userId` is hardcoded as `1` in `onStart()` — needs real auth (Cloudflare Access or similar)

---

## Model

`@cf/moonshotai/kimi-k2.5` via `createWorkersAI()`.

Do not use reasoning models (DeepSeek R1, etc.) — their reasoning tokens leak into chat output.

---

## Running Locally

```bash
npm run dev
```

Wrangler serves the worker on localhost. D1 runs locally via Wrangler's local D1 support. Apply schema and seed:

```bash
wrangler d1 execute riser-db --local --file=schema.sql
wrangler d1 execute riser-db --local --file=seed.sql
```
