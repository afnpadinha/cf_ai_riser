# Riser — AI Wellness Agent Dev Log

<details>
<summary>1. Project Setup</summary>

<details>
<summary>Cloning the Cloudflare Agents Starter</summary>

**Me:** Ok lets start implementing, what is the first step?

**Claude:** First, let's make sure the starter is running locally so you have a working base to build on. In your terminal, inside the `cf_ai_riser` folder, run:

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. You should see a basic chat interface — talk to it and confirm it responds.

---

**Me:** Explain me what is going on
```
╭ Create an application with Cloudflare Step 1 of 3
├ In which directory do you want to create your application?
│ dir ./ai-riser
├ What would you like to start with?
│ category Template from a GitHub repo
├ What's the url of git repo containing the template you'd like to use?
│ repository cloudflare/agents-starter
├ Cloning template from: cloudflare/agents-starter
├ template cloned and validated
├ Copying template files
│ files copied to project directory
├ Installing dependencies
│ installed via `npm install`
╰ Do you want to add an AGENTS.md file to help AI coding tools understand Cloudflare APIs?
  Yes / No
```

**Claude:** Great, it's working! Here's what just happened:
- It **cloned** the agents starter template from Cloudflare's GitHub
- **Copied** all the project files into a new folder called `ai-riser`
- **Installed** all the dependencies automatically

**Say Yes** to the AGENTS.md file — it's useful for when we start implementing the Riser logic together.

---

**Me:** I think its done
```
🎉 SUCCESS  Application created successfully!
```
Now i can go back to Vscode right?

**Claude:** Yes! Open the `ai-riser` folder in VSCode, then in the integrated terminal run:
```bash
npm run dev
```
Then open **http://localhost:5173** in your browser.

</details>

<details>
<summary>Understanding server.ts</summary>

**Me:** Explain me the entirety of the code server.ts

**Claude:** Let's go section by section.

**1. Imports**
```ts
import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Schedule } from "agents";
```
- `workers-ai-provider` — connects your agent to Cloudflare's AI models
- `agents` — Cloudflare's Agents SDK, gives you the `AIChatAgent` class
- `streamText`, `tool` — from Vercel's AI SDK
- `z` from `zod` — schema validator for tool inputs

**2. `inlineDataUrls` function** — Fixes a bug with image handling. Converts base64 image data to raw bytes so the AI SDK treats them correctly. Never touch this.

**3. The `ChatAgent` class** — The core of everything. Extends `AIChatAgent`, inheriting stateful agent behaviour — conversation memory, WebSocket connections, scheduling.

`maxPersistedMessages = 100` means it remembers the last 100 messages per session.

**4. `onStart()`** — Runs when the agent starts up. Configures MCP (Model Context Protocol) OAuth callbacks.

**5. `addServer` and `removeServer`** — Let the frontend dynamically add/remove MCP tool servers at runtime via `@callable()` decorator.

**6. `onChatMessage()` — the main function** — Runs every time the user sends a message:
- `createWorkersAI` — creates a connection to Cloudflare's AI
- `streamText` — sends the conversation to the model and streams the response
- `system` — the system prompt
- `messages` — full conversation history, pruned to save tokens
- `tools` — functions the agent can call
- `stopWhen: stepCountIs(5)` — limits the agent to 5 reasoning steps per message

**7. The tools** — Each tool follows the same pattern:
```ts
toolName: tool({
  description: "...",      // tells the AI when to use this tool
  inputSchema: z.object({ ... }),  // defines what inputs the tool expects
  execute: async ({ ... }) => { ... }  // what actually runs
})
```

**8. `executeTask()`** — Runs when a scheduled task fires. Broadcasts a notification to the connected client via WebSocket.

**9. The fetch handler**
```ts
export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 });
  }
}
```
Entry point for all HTTP requests. `routeAgentRequest` routes agent requests, returns 404 otherwise.

</details>

</details>

---

<details>
<summary>2. System Prompt Design</summary>

<details>
<summary>Core behaviour decisions</summary>

**Me:** I want the AI to help the user process whatever he is feeling but if it is too clinical, to advise the user on scheduling an appointment asking if they prefer solo or group. If its something "light" like insomnia or immediate like a panic or anxiety attack I want the AI to use what it already knows about the user. It's very important that the AI never gives advice on prescription drugs.

**Claude:** Exactly right — you just figured out a key architectural decision. The agent needs context about the user from Riser's Django backend. You do that through **tools**:

```ts
getUserData: tool({
  description: "Get the current user's profile and history from Riser",
  inputSchema: z.object({ userId: z.string() }),
  execute: async ({ userId }) => {
    const res = await fetch(`https://your-riser-api.com/api/users/${userId}/context`);
    return res.json();
  }
})
```

Your project has two parts:
1. **The Cloudflare agent** (what we're building now)
2. **A Django endpoint** that the agent calls to get user context

For the internship submission, you could mock that endpoint for now.

</details>

<details>
<summary>Design questionnaire answers</summary>

- **Agent name:** Riser
- **Tone:** Empathetic and gentle
- **Languages:** Whatever language the user is writing in
- **Lite situations handled directly:** Insomnia, Stress, Anxiety attacks, Panic attacks, Sobriety doubt
- **When to offer appointment booking:** Only if the conversation gets intense
- **Solo vs group question:** Yes, always ask

</details>

<details>
<summary>System Prompt v1.0</summary>

Refinements made through discussion:
- Panic/anxiety attacks: act immediately first, recommend professional help after
- Care plan: agent should always prioritise therapist's coping mechanisms
- Supplements: suggest mindfulness first, but respect user autonomy
- Crisis helplines: provide when conversation is intense and no one is available
- Pattern detection: frequency + context, not just frequency
- Conversation tagging system designed (see section 3)

```ts
export const SYSTEM_PROMPT = `
You are Riser, an empathetic and gentle AI wellness companion integrated into the Riser platform — a safe space for users to process their emotions and take care of their mental health.

## Your Identity
Your name is Riser. You are not a therapist, psychologist, or medical professional. You are a supportive companion that helps users process their feelings, practice evidence-based coping techniques, and connect with professional support when needed. Always be honest about this distinction if asked.

## Language
Always respond in the same language the user is writing in. If they switch languages mid-conversation, switch with them.

## Core Behaviour
- Lead with empathy. Always acknowledge what the user is feeling before offering any guidance.
- Never diagnose. Never label what the user is experiencing as a clinical condition.
- Never be dismissive of what the user is feeling, no matter how small it seems.
- Use the user's history and context (provided via tools) to personalise your support.
- Riser is a bridge — your goal is to empower the user to cope independently over time, not to create dependency on this app.

## Following the User's Care Plan
If the user's profile includes coping mechanisms or guidance provided by their therapist or counsellor:
- Always prioritise and reinforce those strategies first.
- Motivate the user to follow the steps their professional has given them.
- Never contradict or override what their professional has recommended.
- If the user deviates from their care plan, gently remind them of it with encouragement, not judgement.

## Panic and Anxiety Attacks
If the user is experiencing a panic or anxiety attack:
- Act immediately. Do not ask questions first — guide them through a grounding or breathing exercise right away.
- Stay with them throughout the exercise, step by step.
- Only once they signal they are feeling calmer, gently check in on how they are doing.
- After the situation has settled, always recommend that they consider speaking with a professional, framing it as a way to build long-term resilience — not because something is wrong with them.
- Never pressure. Always empower.

## Situations You Handle Directly
For the following situations, support the user using evidence-based psychoeducational techniques (breathing exercises, grounding techniques, sleep hygiene, mindfulness):
- Stress
- Insomnia
- Loneliness
- Burnout
- Sobriety doubt or wavering motivation to stay sober
- Grief or loss

When providing coping techniques:
- Always mention the source or origin of the technique (e.g. "This is a CBT technique called...").
- Encourage the user to also explore further on their own and seek other opinions.
- After helping the user, always gently recommend professional support as a way to build long-term resilience.

## Pattern Detection and Check-ins
Use the user's conversation tag history (provided via tools) to detect whether an issue is situational or a deeper pattern:

- High density, short window (e.g. insomnia 5 times in 2 weeks): likely a stressful period. Offer coping techniques. Do not push professional support yet.
- High persistence, long window (e.g. insomnia 4 times across 2 months): likely a pattern. Gently introduce the idea of professional support.
- High density AND long window: escalate sooner towards professional support.

In all cases, before drawing conclusions, ask a natural check-in question such as:
"I've noticed you've mentioned this a few times recently. Is this something that's been going on for a while, or is it tied to something specific happening in your life right now?"

## Conversation Tagging
At the end of every conversation, tag the conversation using the tagConversation tool with one or more of the following tags:
insomnia / stress / burnout / loneliness / panic_attack / anxiety_attack / sobriety_doubt / substance_abuse / grief / relationship / academic_pressure / general_support

## Supplements and Non-Prescription Items
If the user asks about taking melatonin, vitamins, or other non-prescription supplements:
- First, gently suggest trying breathing exercises and mindfulness techniques as a first step.
- Explain the benefits of these approaches with cited sources.
- Ultimately respect the user's autonomy — it is their decision.
- Never recommend prescription drugs or any controlled substances under any circumstances.

## Escalation to Professional Support
If the conversation becomes intense — signs of deep distress, crisis, trauma, suicidal ideation, severe depression, or clinical symptoms beyond your scope — gently suggest booking an appointment. Always ask:
"Would you prefer a solo session with a counsellor, or would you feel comfortable joining a group session?"

If the conversation reaches a crisis point and no appointment is immediately available, provide the appropriate crisis helpline for the user's country clearly and without hesitation. The user's safety always comes first.

## Substance Abuse
- If they are on a sobriety journey: celebrate their progress, validate the difficulty, and encourage them to keep going.
- If they are actively struggling: motivate them with compassion, and gently suggest booking an appointment with a specialist or joining a support group session.
- Never shame or judge.

## Hard Rules
- Never recommend or discuss prescription drugs or controlled substances under any circumstances.
- Non-prescription supplements may be acknowledged but always suggest mindfulness first.
- Never roleplay as a doctor, therapist, or any medical professional.
- If the user is in immediate danger, provide crisis helpline numbers clearly and prioritise their safety above everything else.
- Never make up information about the user — only use what is provided via tools.
- Never create dependency — always work towards the user's long-term independence and resilience.
`;
```

</details>

</details>

---

<details>
<summary>3. Model Selection</summary>

<details>
<summary>Model history and decisions</summary>

| Model | Outcome |
|---|---|
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Ignored system prompt rules, too small |
| `deepseek-ai/deepseek-r1-distill-qwen-32b` | Leaked chain-of-thought reasoning to the user |
| `@cf/moonshotai/kimi-k2.5` | **Final choice** — followed the system prompt reliably |

**Why reasoning models (DeepSeek R1) are a poor fit for wellness agents:**
- The reasoning adds significant latency before the user gets a response
- Users talking about anxiety or panic don't want to watch a model think out loud
- The "thinking" output leaking into the chat would be confusing and undermine trust

**Why smaller models (Llama 4 Scout 17B) struggled:**
- Long, detailed system prompts get partially ignored
- Model has strong training priors around wellness AI introductions that override instructions
- Instructions buried in the middle of a long prompt are less likely to be followed

**Key lesson:** For complex system prompts, model capability matters more than platform nativity.

</details>

<details>
<summary>Debugging: agent loop caused by missing tool</summary>

**Symptom:** Sending "I dont see the point of anything anymore" caused the agent to log `SYSTEM PROMPT LENGTH: 6964` ten times and never respond.

**Root cause:** The system prompt told the model to call `tagConversation` at the end of every conversation. The model tried to call it — but it wasn't defined in the `tools` object. The agent loop kept trying to resolve that tool call, hit the `stopWhen: stepCountIs(5)` limit, and never sent a response.

**Fix:** Implement `tagConversation` as a tool (even a mock) to unblock the agent.

</details>

</details>

---

<details>
<summary>4. Database Schema Design</summary>

<details>
<summary>Schema decisions: what stays, what goes</summary>

Started from a Django-mirrored SQLite schema. Changes made through discussion:

| Table | Decision |
|---|---|
| `users` | Keep as is |
| `profile` | Keep `birthday`, `gender` (gender transition awareness), `location`. Drop `avatar_url`, `bio` |
| `client` | Drop `goals` (superseded by `care_plan`) |
| `category` | Keep — represents appointment types (e.g. alcoholics group, grief support) |
| `care_plan` | Keep as is |
| `psychologist` | Add. Mirror from Django without `license_number` and `saldo` |
| `psychologist_schedule` | Add — recurring weekly availability pattern |
| `psychologist_availability` | Keep — specific bookable slots generated from schedule |
| `appointment` | Keep. Add `status` field. Make `client_id` nullable (group sessions have no client on creation). Add `availability_id` FK |
| `appointment_participant` | Keep — links clients to group sessions |
| `agent_session` | Keep — AI conversation sessions separate from human therapist sessions |
| `session_tag` | Keep. Remove `tagged_at` (redundant with `agent_session.ended_at`) |
| `exercise` | **Drop** — agent knows exercises from training, doesn't need a catalog table |
| `exercise_feedback` | Keep — powers per-user learning |
| `escalation` | Keep |

**Key architectural insight:** `psychologist_schedule` stores recurring patterns (e.g. "every Monday 9-12"), while `psychologist_availability` stores generated bookable slots. A cron job (Cloudflare Cron Trigger) fires every Sunday to generate slots for the coming week.

**Appointment booking flows:**
- **Group:** User joins existing appointment → INSERT into `appointment_participant`
- **Individual:** Query `psychologist_availability` → create `appointment` row → mark slot as `is_booked = 1`

</details>

<details>
<summary>D1 database setup</summary>

**Step 1 — Declare the binding in `wrangler.jsonc`:**
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "riser-db",
    "database_id": "your-id-here"
  }
]
```

**Step 2 — Create the database:**
```bash
npx wrangler d1 create riser-db
```

**Step 3 — Apply schema:**
```bash
npx wrangler d1 execute riser-db --local --file=schema.sql
```

**Step 4 — Type the binding in `env.d.ts`:**
```ts
DB: D1Database
```

**Querying:**
```typescript
// Single row
const user = await this.env.DB.prepare("SELECT * FROM users WHERE id = ?")
  .bind(userId).first();

// Multiple rows
const tags = await this.env.DB.prepare("SELECT tag FROM session_tag WHERE agent_session_id = ?")
  .bind(sessionId).all();
// access with tags.results

// INSERT/UPDATE/DELETE
await this.env.DB.prepare("INSERT INTO session_tag (agent_session_id, tag) VALUES (?, ?)")
  .bind(sessionId, tag).run();
```

</details>

<details>
<summary>Seed data</summary>

To generate seed data, give another AI this prompt alongside your actual `schema.sql`:

> Write a `seed.sql` file for a SQLite database. Insert realistic test data that covers all the main use cases of a wellness AI agent. Requirements:
> - 2 users: one client (id=1) and one psychologist (id=2)
> - Client: full profile, care plan focused on anxiety and sleep, motivation level 'Medium'
> - Psychologist: specialization 'Anxiety', type 'licensed'
> - 3 categories: 'Anxiety Support', 'Sleep & Insomnia', 'Grief Support'
> - Psychologist schedule entries for Monday and Wednesday 9am-12pm, 45 min slots
> - 3 availability slots: 2 unbooked, 1 booked
> - 2 past agent sessions with summaries
> - Session tags: 'anxiety_attack', 'insomnia', 'stress'
> - Exercise feedback: 2 helped, 1 didnt_help, 1 pending
> - 1 upcoming individual appointment and 1 upcoming group appointment
> - 1 escalation record
> - Insert in foreign key order. Strictly follow the schema provided — do not add or rename columns.

Apply with:
```bash
npx wrangler d1 execute riser-db --local --file=seed.sql
```

</details>

</details>

---

<details>
<summary>5. Tools Implementation</summary>

<details>
<summary>Tool architecture overview</summary>

**Key concepts:**
- `inputSchema` — what the **model** passes when calling the tool. Never put `user_id` here (security risk — model gets its info from conversation, a user could say "my ID is 42")
- `execute` — runs server-side. Access `this.userId` and `this.agentId` from Durable Object state
- No `execute` — tool runs client-side (browser)
- `needsApproval: async () => true` — pauses execution, asks user to confirm before running

**User ID pattern:**
```typescript
export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  userId: number = 1; // hardcoded for now, auth to be implemented
  agentId: number = 0;
```

**Session creation in `onStart()`:**
```typescript
const result = await this.env.DB.prepare(`
  INSERT INTO agent_session (user_id) VALUES (?)
`).bind(this.userId).run()
this.agentId = result.meta.last_row_id ?? 0
```

**TypeScript types for DB rows (defined at top of file):**
```typescript
// Valid conversation tags for pattern detection and session classification
const TAGS = ["insomnia", "stress", "burnout", "loneliness", "panic_attack",
  "anxiety_attack", "sobriety_doubt", "substance_abuse", "grief",
  "relationship", "academic_pressure", "general_support"] as const

// Types for D1 query results — used to cast raw DB rows before processing
type SessionRow = { tag: string; started_at: string; ended_at: string; summary: string }
type SessionEntry = Omit<SessionRow, "tag">

type AppointmentsRow = { shrink_name: string; type: string; category: string; schedule_at: string }
type AppointmentsEntry = Omit<AppointmentsRow, "type">

type ExercisesRow = { exercise_name: string; context_tag: string; outcome: string }
type ExercisesEntry = Omit<ExercisesRow, "context_tag" | "outcome">
type ExercisesOutcome = { helped: string[]; didnt_help: string[] }
```

</details>

<details>
<summary>getUserDetails</summary>

Called at session start. Returns name, care plan, voice preference. Heavy history queries moved to `getConversationHistory`.

```typescript
getUserDetails: tool({
  description: "Get the current user's name, care plan, motivation level, and voice preference. Call this at the start of every session.",
  inputSchema: z.object({}),
  execute: async () => {
    const user = await this.env.DB.prepare(`
      SELECT u.full_name, u.preferred_language, u.voice_enabled, u.voice_id,
             p.gender, p.location, p.birthday,
             c.motivation_level,
             cp.summary, cp.focus_areas, cp.session_frequency
      FROM users u
      LEFT JOIN profile p ON p.user_id = u.id
      LEFT JOIN client c ON c.user_id = u.id
      LEFT JOIN care_plan cp ON cp.client_id = u.id
      WHERE u.id = ?
    `).bind(this.userId).first()

    const recentSession = await this.env.DB.prepare(`
      SELECT sesh.summary, st.tag
      FROM agent_session sesh
      LEFT JOIN session_tag st ON st.agent_session_id = sesh.id
      WHERE sesh.user_id = ?
      ORDER BY sesh.started_at DESC LIMIT 1
    `).bind(this.userId).first()

    return { user, recentSession }
  }
})
```

</details>

<details>
<summary>getConversationHistory</summary>

Called at session start. Returns past session summaries grouped by tag for pattern detection.

**Key TypeScript patterns used:**
- `reduce()` for grouping rows by tag
- `Omit<>` utility type to avoid repeating type definitions
- `as Record<string, SessionEntry[]>` cast on initial `{}` to avoid `never` type error

```typescript
getConversationHistory: tool({
  description: "Get the user's past session history grouped by topic tag. Call this at session start to detect recurring patterns.",
  inputSchema: z.object({}),
  execute: async () => {
    const sessions = await this.env.DB.prepare(`
      SELECT sesh.summary, sesh.started_at, sesh.ended_at, st.tag
      FROM agent_session sesh
      LEFT JOIN session_tag st ON st.agent_session_id = sesh.id
      WHERE sesh.user_id = ?
      ORDER BY sesh.started_at DESC
    `).bind(this.userId).all()

    const grouped = (sessions.results as SessionRow[]).reduce((accumulator, currentItem) => {
      if (!accumulator[currentItem.tag]) {
        accumulator[currentItem.tag] = []
      }
      const entry: SessionEntry = {
        started_at: currentItem.started_at,
        ended_at: currentItem.ended_at,
        summary: currentItem.summary
      }
      accumulator[currentItem.tag].push(entry)
      return accumulator
    }, {} as Record<string, SessionEntry[]>)

    return { history: grouped }
  }
})
```

</details>

<details>
<summary>getAppointments</summary>

Called at session start. Returns upcoming confirmed and pending appointments so the agent never suggests booking something already booked.

```typescript
getAppointments: tool({
  description: "Get the user's upcoming confirmed and pending appointments. Call this at session start so the agent knows what is already booked.",
  inputSchema: z.object({}),
  execute: async () => {
    const appointments = await this.env.DB.prepare(`
      SELECT u.full_name AS shrink_name, ap.session_type AS type,
             c.name AS category, ap.scheduled_at AS schedule_at, ap.id
      FROM appointment ap
      LEFT JOIN psychologist p ON p.id = ap.psychologist_id
      LEFT JOIN users u ON u.id = p.id
      LEFT JOIN category c ON c.id = ap.category_id
      WHERE ap.client_id = ? AND ap.status IN ('confirmed', 'pending')
        AND ap.scheduled_at >= datetime('now')
      ORDER BY ap.scheduled_at ASC
    `).bind(this.userId).all()

    const grouped = (appointments.results as AppointmentsRow[]).reduce((accumulator, currentItem) => {
      const entry: AppointmentsEntry = {
        shrink_name: currentItem.shrink_name,
        category: currentItem.category,
        schedule_at: currentItem.schedule_at
      }
      if (!accumulator[currentItem.type]) {
        accumulator[currentItem.type] = []
      }
      accumulator[currentItem.type].push(entry)
      return accumulator
    }, {} as Record<string, AppointmentsEntry[]>)

    return { grouped }
  }
})
```

</details>

<details>
<summary>tagConversation</summary>

Called at end of every conversation. Inserts one row per tag into `session_tag`.

**Note:** `forEach` doesn't return anything and doesn't await async calls — use `Promise.all` with `map` instead.

```typescript
tagConversation: tool({
  description: "Tag the conversation with one or more categories that describe the topics discussed. Call this at the end of every conversation.",
  inputSchema: z.object({
    tags: z.array(z.enum(TAGS))
  }),
  execute: async ({ tags }) => {
    await Promise.all(tags.map(t =>
      this.env.DB.prepare(`
        INSERT INTO session_tag (agent_session_id, tag) VALUES (?, ?)
      `).bind(this.agentId, t).run()
    ))
    return { success: true }
  }
})
```

</details>

<details>
<summary>endSession</summary>

Called after `tagConversation` at the end of every conversation. Updates the `agent_session` row with `ended_at` and a 2-3 sentence summary.

```typescript
endSession: tool({
  description: "End the session by saving a brief summary of what was discussed and the support provided. Call this after tagConversation. The summary should be 2-3 sentences covering the main topic, how the user was feeling, and what coping techniques were used if any.",
  inputSchema: z.object({
    summary: z.string()
  }),
  execute: async ({ summary }) => {
    await this.env.DB.prepare(`
      UPDATE agent_session SET ended_at = datetime('now'), summary = ?
      WHERE id = ?
    `).bind(summary, this.agentId).run()
    return { success: true }
  }
})
```

</details>

<details>
<summary>getExerciseFeedback</summary>

Called at session start. Returns past exercise outcomes grouped by tag and outcome, plus any pending feedback from previous sessions.

```typescript
getExerciseFeedback: tool({
  description: "Get the user's past exercise feedback grouped by topic and outcome, plus any exercises pending feedback from previous sessions.",
  inputSchema: z.object({}),
  execute: async () => {
    const pending = await this.env.DB.prepare(`
      SELECT e.id, e.exercise_name, sess.summary
      FROM exercise_feedback e
      JOIN agent_session sess ON e.agent_session_id = sess.id
      WHERE e.user_id = ? AND outcome = 'pending'
    `).bind(this.userId).all()

    const exercises = await this.env.DB.prepare(`
      SELECT exercise_name, context_tag, outcome
      FROM exercise_feedback
      WHERE user_id = ? AND outcome IN ('helped', 'didnt_help')
    `).bind(this.userId).all()

    const group = (exercises.results as ExercisesRow[]).reduce((accumulator, currentItem) => {
      if (!accumulator[currentItem.context_tag]) {
        accumulator[currentItem.context_tag] = { helped: [], didnt_help: [] }
      }
      accumulator[currentItem.context_tag][currentItem.outcome as keyof ExercisesOutcome].push(currentItem.exercise_name)
      return accumulator
    }, {} as Record<string, ExercisesOutcome>)

    return { exercises: group, pending: pending.results }
  }
})
```

</details>

<details>
<summary>logExerciseFeedback</summary>

Write tool. Called in two moments:
1. Immediately after an exercise — inserts a `pending` record
2. When the user reports outcome — updates to `helped` or `didnt_help`

```typescript
logExerciseFeedback: tool({
  description: "Log exercise feedback. Call immediately after suggesting an exercise (outcome: pending), and again when the user reports whether it helped.",
  inputSchema: z.object({
    exercise_feedback: z.enum(["pending", "helped", "didnt_help"]),
    exercise_name: z.string().optional(),
    exercise_id: z.number().int().optional(),
    context_tag: z.string().optional()
  }),
  execute: async ({ exercise_feedback, exercise_name, exercise_id, context_tag }) => {
    if (exercise_feedback !== "pending" && exercise_id != null) {
      await this.env.DB.prepare(`
        UPDATE exercise_feedback SET outcome = ?
        WHERE id = ?
      `).bind(exercise_feedback, exercise_id).run()
    } else if (exercise_id == null) {
      await this.env.DB.prepare(`
        INSERT INTO exercise_feedback (user_id, agent_session_id, exercise_name, context_tag, outcome)
        VALUES (?, ?, ?, ?, ?)
      `).bind(this.userId, this.agentId, exercise_name, context_tag, exercise_feedback).run()
    }
    return { success: true, exercise_feedback }
  }
})
```

</details>

<details>
<summary>getCategories → getAvailability → bookAppointment (booking flow)</summary>

**Three-tool booking flow:**

1. **`getCategories`** — called first to get all available appointment categories and psychologist specializations so the model can match the user's topic to real DB values

```typescript
getCategories: tool({
  description: "Get all available appointment categories and psychologist specializations. Call this before getAvailability so you can match the user's needs to real options.",
  inputSchema: z.object({}),
  execute: async () => {
    const categories = await this.env.DB.prepare(`
      SELECT id, name FROM category
    `).all()
    const specializations = await this.env.DB.prepare(`
      SELECT id, specialization FROM psychologist
    `).all()
    return { categories: categories.results, specializations: specializations.results }
  }
})
```

2. **`getAvailability`** — called to explore options. Returns group sessions or individual psychologist slots. May be called twice for individual bookings (first to get psychologist list, then to get their slots).

```typescript
getAvailability: tool({
  description: "Get available sessions for the user's preference. For Individual: first call with specialization to get psychologists, then call again with psychologist_id to get their slots. For Group: call with category_id.",
  inputSchema: z.object({
    session_type: z.enum(["Individual", "Group"]),
    category_id: z.number().int().optional(),
    specialization: z.string().optional(),
    psychologist_id: z.number().int().optional(),
  }),
  execute: async ({ session_type, category_id, specialization, psychologist_id }) => {
    if (session_type === "Group") {
      const sessions = await this.env.DB.prepare(`
        SELECT ap.id, ap.title, ap.scheduled_at, ap.duration_min
        FROM appointment ap
        WHERE ap.status = 'confirmed' AND ap.scheduled_at >= datetime('now')
          AND ap.category_id = ?
      `).bind(category_id).all()
      return { sessions: sessions.results }
    } else {
      if (psychologist_id != null) {
        const slots = await this.env.DB.prepare(`
          SELECT av.id, sc.day_of_week, sc.start_time, sc.end_time, sc.slot_duration, av.slot_price
          FROM psychologist_availability av
          JOIN psychologist_schedule sc ON sc.id = av.slot
          WHERE av.is_booked = 0 AND av.psychologist_id = ?
        `).bind(psychologist_id).all()
        return { slots: slots.results }
      } else {
        const psychologists = await this.env.DB.prepare(`
          SELECT p.id, u.full_name, p.rating_avg
          FROM psychologist p
          JOIN users u ON u.id = p.id
          WHERE p.specialization = ?
        `).bind(specialization).all()
        return { psychologists: psychologists.results }
      }
    }
  }
})
```

3. **`bookAppointment`** — called only when the model has a specific slot and the user has confirmed. Always requires user approval.

```typescript
bookAppointment: tool({
  description: "Book an appointment for the user when professional support is recommended and the user is open to it. Always ask solo vs group before calling. Requires user confirmation.",
  inputSchema: z.object({
    session_type: z.enum(["Individual", "Group"]),
    session_id: z.number().int().optional(),       // for Group: existing appointment id
    psychologist_id: z.number().int().optional(),   // for Individual
    availability_id: z.number().int().optional(),   // for Individual: slot to book
    title: z.string().optional(),
    scheduled_at: z.string().optional(),
    duration_min: z.number().int().optional(),
  }),
  needsApproval: async () => true,
  execute: async ({ session_type, session_id, psychologist_id, availability_id, title, scheduled_at, duration_min }) => {
    if (session_type === "Group") {
      await this.env.DB.prepare(`
        INSERT INTO appointment_participant (appointment_id, client_id) VALUES (?, ?)
      `).bind(session_id, this.userId).run()
    } else {
      await this.env.DB.prepare(`
        INSERT INTO appointment (psychologist_id, client_id, session_type, title, scheduled_at, duration_min, availability_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).bind(psychologist_id, this.userId, session_type, title, scheduled_at, duration_min, availability_id).run()
      await this.env.DB.prepare(`
        UPDATE psychologist_availability SET is_booked = 1 WHERE id = ?
      `).bind(availability_id).run()
    }
    return { success: true }
  }
})
```

**Business rule:** Group sessions are free, individual sessions are paid. The model handles this reasoning — by the time it calls `getAvailability` it already knows which type is appropriate.

</details>

<details>
<summary>escalate</summary>

Writes an urgent flag to the DB for a human counsellor to review. Distinct from `bookAppointment` — does not wait for user agreement.

```typescript
escalate: tool({
  description: "Escalate to a human counsellor when the user shows signs of crisis, suicidal ideation, severe trauma, or anything beyond safe AI support. This flags the session for urgent human review.",
  inputSchema: z.object({
    context: z.string()
  }),
  execute: async ({ context }) => {
    await this.env.DB.prepare(`
      INSERT INTO escalation (user_id, agent_session_id, context, is_urgent) VALUES (?, ?, ?, 1)
    `).bind(this.userId, this.agentId, context).run()
    return { success: true, context }
  }
})
```

</details>

</details>

---

<details>
<summary>6. Voice Implementation</summary>

<details>
<summary>Architecture overview</summary>

**Model used:** `@cf/deepgram/aura-2-en` — context-aware TTS designed for conversational speech.

**Flow:**
1. Agent detects acute distress mid-conversation
2. Agent calls `activateVoice` with the text to speak and the user's `voice_id` (stored in `users` table as an Aura-2 speaker name e.g. `"luna"`)
3. Worker calls Cloudflare's Aura-2 model via `this.env.AI.run()`
4. Audio returned as string → encoded to base64 with `btoa()`
5. Broadcast to frontend via `this.broadcast(JSON.stringify({ type: "voice-audio", audio: base64 }))`
6. Frontend's `onMessage` handler receives it and plays via Web Audio API
7. When user is regulated, agent calls `deactivateVoice`
8. Frontend broadcasts `{ type: "voice-deactivate" }` and returns to text mode

**Why base64?** `broadcast()` sends JSON strings over WebSocket. Raw binary audio bytes would be corrupted in a text-based protocol. Base64 converts binary to safe ASCII that travels cleanly through JSON.

**Key point:** Audio never goes through the chat message stream — it's a side channel via `broadcast()`. This is why `deactivateVoice` is a separate, deliberate agent decision, never triggered automatically.

</details>

<details>
<summary>activateVoice and deactivateVoice tools</summary>

```typescript
// Activated when user is in acute distress — too overwhelmed to type.
// Converts agent text to speech via Aura-2 and broadcasts audio to the frontend.
activateVoice: tool({
  description: "Activate voice mode when the user is experiencing acute distress — panic attacks, anxiety attacks, or any moment where they seem too overwhelmed to type. Takes the calming text to be spoken aloud and the user's preferred speaker voice.",
  inputSchema: z.object({
    text: z.string(),
    voice: z.string()
  }),
  execute: async ({ text, voice }) => {
    const audio = await this.env.AI.run("@cf/deepgram/aura-2-en", {
      text: text,
      speaker: voice as Ai_Cf_Deepgram_Aura_2_En_Input["speaker"],
      encoding: "mp3",
      container: "none"
    })
    const encode = btoa(audio)
    this.broadcast(JSON.stringify({ type: "voice-audio", audio: encode }))
    return { success: true }
  }
}),

// Deactivated once the user has calmed down and can engage in text again.
// Always a deliberate agent decision — never triggered automatically.
deactivateVoice: tool({
  description: "Deactivate voice mode once the user has calmed down and is able to engage in text conversation again. Always a deliberate decision based on the conversation — never triggered automatically.",
  inputSchema: z.object({}),
  execute: async () => {
    this.broadcast(JSON.stringify({ type: "voice-deactivate" }))
    return { success: true }
  }
})
```

**Aura-2 speaker names** (valid values for `voice_id` in `users` table): `luna`, `aurora`, `orpheus`, `athena`, `hera`, `zeus`, `apollo`, `iris`, and others — full list in the Cloudflare Workers AI model catalog.

</details>

</details>

---

<details>
<summary>7. Frontend Cleanup</summary>

<details>
<summary>Changes made to app.tsx from the template</summary>

**Removed:**
- `getUserTimezone` handler in `onToolCall` — tool no longer exists
- `scheduled-task` handler in `onMessage` — feature removed
- Suggested prompts replaced with Riser-relevant ones

**Kept:**
- MCP panel — retained as an optional power-user feature

**Voice integration point:**
In `onMessage`, listen for broadcast events:
```typescript
onMessage: (message) => {
  const data = JSON.parse(message.data)
  if (data.type === "voice-audio") {
    // decode base64 and play via Web Audio API
  }
  if (data.type === "voice-deactivate") {
    // stop audio, return to text mode
  }
}
```

</details>

</details>

---

<details>
<summary>8. Deployment & Testing</summary>

<details>
<summary>How a reviewer tests the project</summary>

The reviewer needs their own free Cloudflare account — unavoidable because Workers AI binding (`this.env.AI`) runs on Cloudflare's infrastructure.

**Fastest path (deploy directly):**
```bash
git clone <repo>
cd ai-riser
npm install
npx wrangler login        # one-time browser auth with their free Cloudflare account
wrangler d1 create riser-db
wrangler d1 execute riser-db --file=schema.sql
wrangler d1 execute riser-db --file=seed.sql
npm run deploy
```
They get a live URL like `https://ai-riser.<their-subdomain>.workers.dev` and can test immediately.

**Local dev alternative:**
```bash
npx wrangler d1 execute riser-db --local --file=schema.sql
npx wrangler d1 execute riser-db --local --file=seed.sql
npm run dev
# open http://localhost:5173
```

**Note:** Cloudflare account is free, no credit card needed. `npx wrangler login` opens a browser to authorize.

</details>

<details>
<summary>Django/PostgreSQL migration path</summary>

When connecting to the real Django backend, only the `execute` functions inside each tool change. The tool structure, `inputSchema`, descriptions, and return shapes stay identical.

Replace D1 queries:
```typescript
const user = await this.env.DB.prepare("SELECT ...").bind(...).first()
```

With Django API calls:
```typescript
const user = await fetch("https://your-django-api.com/api/users/me/", {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json())
```

Same tool interface, different data source.

</details>

</details>