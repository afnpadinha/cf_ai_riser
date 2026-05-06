import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Schedule } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage
} from "ai";
import { z } from "zod";
import{SYSTEM_PROMPT} from "./prompt";



// Valid conversation tags for pattern detection and session classification
const TAGS = ["stress", "burnout", "insomnia", "loneliness", "panic_attack", "anxiety_attack", "sobriety_doubt", "substance_abuse", 
  "grief", "relationship", "academic_pressure", "work_pressure", "general_support"
] as const

// Types for D1 query results — used to cast raw DB rows before processing
type SessionRow = {
  tag: string
  started_at: string
  ended_at: string
  summary: string
}
type SessionEntry = Omit<SessionRow, "tag">

type AppointmentsRow = {
  shrink_name: string
  type: string
  category: string
  schedule_at: string
}
type AppointmentsEntry = Omit<AppointmentsRow, "type">

type ExercisesRow = {
  exercise_name: string
  context_tag: string
  outcome: string
}

type ExercisesOutcome = {
  helped: string[]
  didnt_help: string[]
}

/**
 * The AI SDK's downloadAssets step runs `new URL(data)` on every file
 * part's string data. Data URIs parse as valid URLs, so it tries to
 * HTTP-fetch them and fails. Decode to Uint8Array so the SDK treats
 * them as inline data instead.
 */

function inlineDataUrls(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "file" || typeof part.data !== "string") return part;
        const match = part.data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return part;
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        return { ...part, data: bytes, mediaType: match[1] };
      })
    }
  })
}

// Riser AI Agent — Durable Object that manages conversation state, DB access, and tool execution
export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100
  userId!: number;
  agentId!: number;

  // Runs once when the agent starts — hardcoded userId for now (auth to be implemented)
  // Creates a new agent_session row in the DB and stores the session ID for tool use
  async onStart() {
    this.userId = 1;
    const result = await this.env.DB.prepare(`
      INSERT INTO agent_session (user_id) VALUES (?)
    `).bind(this.userId).run()
    this.agentId= result.meta.last_row_id ?? 0
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          })
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        )
      }
    })
  }

  //Adds server for the ai agent 
  @callable()
  async addServer(name: string, url: string) {
    return await this.addMcpServer(name, url)
  }

  //Removes server for the ai agent 
  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId)
  }

  //Defines the system prompt, the ai model, when to prune messages and all the callabel tools
  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools()
    const workersai = createWorkersAI({ binding: this.env.AI })

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.5", {
        sessionAffinity: this.sessionAffinity
      }),
      system: SYSTEM_PROMPT,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: inlineDataUrls(await convertToModelMessages(this.messages)),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // MCP tools from connected servers
        ...mcpTools,

        // Tags the conversation with the user with one or more of the Tags defined above 
        // It makes it easier to detect paterns
        tagConversation: tool({
          description: "Tag the conversation with one or more categories that describe the topics discussed. Call this at the end of every conversation.",
          inputSchema: z.object({
            tags: z.array(z.enum(TAGS))
          }),
          execute: async ({ tags }) => {
              await Promise.all(tags.map(t=>
                this.env.DB.prepare(`
                INSERT INTO session_tag (agent_session_id, tag) VALUES (?, ?)
                `).bind(this.agentId, t).run()
              ))
            return {
              success: true
            }
          }
        }),


        endsConversation: tool({
          description: "End the session by saving a brief summary of what was discussed and the support provided. Call this after tagConversation. The summary should be 2-3 sentences covering the main topic, how the user was feeling, and what coping techniques were used if any.",
          inputSchema: z.object({
            tags: z.array(z.enum(TAGS))
          }),
          execute: async ({ tags }) => {
              await Promise.all(tags.map(t=>
                this.env.DB.prepare(`
                INSERT INTO session_tag (agent_session_id, tag) VALUES (?, ?)
                `).bind(this.agentId, t).run()
              ))
            return {
              success: true
            }
          }
        }),

        // Gets user details inj the beginning of every conversation 
        // for the agent to have context about the person he is speaking with
        getUserDetails: tool({
          description:
            "Get the user's name, care plan, voice preference, past conversation tags, exercise history with outcomes per tag, and any pending feedback from the last session.",
          inputSchema: z.object({}),
          execute: async({}) =>{
            const user = await this.env.DB.prepare(`
              SELECT u.username, u.full_name, u.voice_id, p.birthday, p.gender, p.user_location, c.motivation_level, c.plan_type
              FROM users u
              LEFT JOIN profile p ON p.user_id = u.id
              LEFT JOIN client c ON c.user_id = u.id
              WHERE u.id = ?
              `
            ).bind(this.userId).first()
            const careplan = await this.env.DB.prepare(`
              SELECT * FROM care_plan WHERE client_id = ?
            `).bind(this.userId).first()
            const session = await this.env.DB.prepare(`
              SELECT sesh.summary, st.tag
              FROM agent_session sesh
              LEFT JOIN session_tag st ON st.agent_session_id = sesh.id
              WHERE sesh.user_id = ?
            `).bind(this.userId).all()
            const feedback = await this.env.DB.prepare(`
              SELECT exercise_name, outcome
              FROM exercise_feedback 
              WHERE user_id = ?
              `
            ).bind(this.userId).all()

            return {
              user: user,
              carePlan: careplan,
              recentTags: session.results,
              exerciseHistory: feedback.results
            }
          }
        }),

        // Approval tool: requires user confirmation before executing
        getConversationHistory: tool({
          description:
            "Get the user's conversation history for pattern detection",
          inputSchema: z.object({}),
          execute: async({}) =>{
            const history = await this.env.DB.prepare(`
              SELECT st.tag, sess.started_at, sess.ended_at, sess.summary
              FROM session_tag st
              JOIN agent_session sess ON sess.id = st.agent_session_id
              WHERE sess.user_id = ?
              ORDER BY st.tag, sess.started_at ASC
              `).bind(this.userId).all()
            const grouped = (history.results as SessionRow[]).reduce((accumulator, currentItem) => {
              const key: SessionEntry = {
                started_at : currentItem.started_at,
                ended_at : currentItem.ended_at,
                summary : currentItem.summary
              }
              if(!accumulator[currentItem.tag]){
                accumulator[currentItem.tag] = []
              } 
              accumulator[currentItem.tag].push(key)
              return accumulator
            }, {} as Record<string, SessionEntry[]>)
            return{
              grouped
            }
          }
        }),

        getAppointments: tool({
          description:
            "Get the user's upcoming confirmed and pending appointments. Call this at session start so the agent knows what is already booked.",
            inputSchema: z.object({}),
            execute:async({})=>{
              const appointments = await this.env.DB.prepare(`
                SELECT u.full_name AS shrink_name, ap.session_type AS type, c.name AS category, ap.scheduled_at AS schedule_at
                FROM appointment ap
                LEFT JOIN psychologist p ON  p.id = ap.psychologist_id
                LEFT JOIN users u ON u.id = p.id
                LEFT JOIN category c ON c.id = ap.category_id
                WHERE ap.client_id = ? AND ap.status IN ('confirmed', 'pending') AND ap.scheduled_at >= datetime('now') 
                ORDER BY ap.scheduled_at ASC
              `).bind(this.userId).all()
              const grouped = (appointments.results as AppointmentsRow[]).reduce((accumulator, currentItem) => {
                const key: AppointmentsEntry = {
                  shrink_name : currentItem.shrink_name,
                  category : currentItem.category,
                  schedule_at : currentItem.schedule_at
                }
                if(!accumulator[currentItem.type]){
                  accumulator[currentItem.type] = []
                } 
                accumulator[currentItem.type].push(key)
                return accumulator

              }, {} as Record<string, AppointmentsEntry[]>)
              return {
                grouped
              }
            }
        }),

        getCategories: tool({
          description: "Get all the available categories and specializations",
          inputSchema: z.object({}),
          execute: async () => {
            const categories = await this.env.DB.prepare(`
              SELECT id, name
              FROM category
            `).all()
            const specializations = await this.env.DB.prepare(`
              SELECT id, specialization
              FROM psychologist
            `).all()
            return {
              categories : categories.results,
              specializations : specializations.results
            }
          }
        }),

        getAvailability: tool({
          description: "Get all the available sessions for the users preference and availability",
          inputSchema: z.object({
            session_type: z.enum(["Individual", "Group"]), 
            category_id: z.number().int().optional(),
            specialization: z.string().optional(),
            psychologist_id: z.number().int().optional(),
          }),
          execute: async ({session_type, category_id, specialization, psychologist_id}) => {
            if (session_type === "Group"){
              const session = await this.env.DB.prepare(`
                SELECT id, title, scheduled_at, duration_min
                FROM appointment
                WHERE status IN ('confirmed') AND scheduled_at >= datetime('now') AND category_id = ?
              `).bind(category_id).all()
              return {
                sessions: session.results
              }
            }
            else{
              const psychologist = await this.env.DB.prepare(`
                SELECT p.id, u.full_name, p.rating_avg
                FROM psychologist p
                JOIN users u ON u.id = p.id
                WHERE specialization = ?
              `).bind(specialization).all()
              if(psychologist_id != null){
                const session = await this.env.DB.prepare(`
                  SELECT sc.day_of_week, sc.start_time, sc.end_time, sc.slot_duration, av.slot_price
                  FROM psychologist_availability av
                  JOIN psychologist_schedule sc ON sc.id = av.slot
                  WHERE av.is_booked = 0 AND av.psychologist_id = ?
                `).bind(psychologist_id).first()
                return {
                  sessions: session,
                  psychologist_id
                }
              }
              return {
                psychologists: psychologist.results
              } 
            }
          }
        }),

        bookAppointment: tool({
          description: "Book an appointment for the user when the topic is becoming to dense and out of your reach to help",
          inputSchema: z.object({
            session_type: z.enum(["Individual", "Group"]),
            session_id: z.number().int().optional(),
            psychologist_id: z.number().int().optional(),
            availability_id: z.number().int().optional(),
            title: z.string().optional(),
            scheduled_at: z.string().optional(),
            duration_min: z.number().int().optional(),
          }),
          needsApproval: async() => true,
          execute: async ({session_type, session_id, psychologist_id, availability_id, scheduled_at, duration_min, title}) => {
            if(session_type === "Group"){
              await this.env.DB.prepare(`
                INSERT INTO appointment_participant (appointment_id, client_id) VALUES (?, ?)
              `).bind(session_id, this.userId).run()
            } else {
              await this.env.DB.prepare(`
                INSERT INTO appointment (psychologist_id, client_id, availability_id, session_type, title, scheduled_at, duration_min, status) VALUES (?, ?,?, ?, ?, ?, ?, 'pending')
              `).bind(psychologist_id, this.userId, availability_id, session_type, title, scheduled_at, duration_min).run()
              await this.env.DB.prepare(`
                UPDATE psychologist_availability SET is_booked = 1
                WHERE id = ?
              `).bind(availability_id).run()
            }
            return { success: true, session_type }
          }
        }),

        getExerciseFeedback: tool({
          description: "Get the user's feedback for already executed exercises ",
          inputSchema: z.object({}),
          execute: async () => {
            const pending = await this.env.DB.prepare(`
              SELECT e.id, e.exercise_name, sess.summary
              FROM exercise_feedback e
              JOIN agent_session sess ON e.agent_session_id = sess.id
              WHERE e.user_id = ? AND e.outcome = 'pending'
            `).bind(this.userId).all()
            const exercises = await this.env.DB.prepare(`
              SELECT exercise_name, context_tag, outcome
              FROM exercise_feedback
              WHERE user_id = ? AND outcome IN ('helped', 'didnt_help')
            `).bind(this.userId).all()
            const group = (exercises.results as ExercisesRow[]).reduce((accumulator, currentItem) => {
              if(!accumulator[currentItem.context_tag]){
                accumulator[currentItem.context_tag] = {
                  helped: [],
                  didnt_help: []
                }
              }
              accumulator[currentItem.context_tag][currentItem.outcome as keyof ExercisesOutcome].push(currentItem.exercise_name)
              return accumulator
            }, {} as Record<string, ExercisesOutcome>)
            return {
              exercises:group,
              pending: pending.results
            }
          }
        }),

        logExerciseFeedback: tool({
          description: "Log the user's feedback for pending executed exercises ",
          inputSchema: z.object({
            exercise_feedback: z.enum(["pending", "helped", "didnt_help"]),
            exercise_name: z.string().optional(),
            exercise_id: z.number().int().optional(),
            context_tag: z.string().optional()
          }),
          execute: async ({exercise_feedback, exercise_name, exercise_id, context_tag}) => {
            if(exercise_feedback != "pending" && exercise_id != null){
              await this.env.DB.prepare(`
                UPDATE exercise_feedback SET outcome=?
                WHERE id = ?
              `).bind(exercise_feedback, exercise_id).run()
            } else if(exercise_id === null){
              await this.env.DB.prepare(`
                INSERT INTO exercise_feedback  (user_id, agent_session_id, exercise_name, context_tag, outcome) VALUES (?, ?, ?, ?, ?)
              `).bind(this.userId, this.agentId, exercise_name, context_tag, exercise_feedback).run()
            }
          return { success: true, exercise_feedback }
          }
        }),

        escalate: tool({
          description: "Escalate to a human counsellor when the user shows signs of crisis, suicidal ideation, severe trauma, or anything beyond safe AI support. This flags the session for urgent human review.",
          inputSchema: z.object({
            context: z.string()
          }),
          execute: async ({context}) => {
          await this.env.DB.prepare(`
            INSERT INTO escalation  (user_id, agent_session_id, context, is_urgent) VALUES (?, ?, ?, 1)
          `).bind(this.userId, this.agentId, context).run()
          return { success: true, context }
          }
        }),

        //activates text-to-audio when the user is having a any type of problem that 
        // would make him unconfurtable to write in the chat
        activateVoice: tool({
          description: "Activate voice mode when the user is experiencing acute distress — panic attacks, anxiety attacks, or any moment where they seem too overwhelmed to type. Takes the calming text to be spoken aloud and the user's preferred speaker voice.",
          inputSchema: z.object({
            text: z.string(),
            voice: z.string(),
          }),
          execute: async ({text, voice}) => {
            const audio = await this.env.AI.run("@cf/deepgram/aura-2-en", {
              text: text,
              speaker: voice as Ai_Cf_Deepgram_Aura_2_En_Input["speaker"], //trust me this is avalid string speaker
              encoding: "mp3"
            })
            const uint8 = new Uint8Array(audio as unknown as ArrayBuffer)
            const binary = Array.from(uint8).map(b => String.fromCharCode(b)).join('')
            const encode = btoa(binary)
            this.broadcast(JSON.stringify({ type: "voice-audio", audio: encode }))
          return { success: true}
          }
        }),

        //deactivates text-to-audio when the user is no longer having a any type of problem that 
        // would make him unconfurtable to write in the chat
        deactivateVoice: tool({
          description: "Deactivate voice mode once the user has calmed down and is able to engage in text conversation again. Always a deliberate decision based on the conversation — never triggered automatically.",
          inputSchema: z.object({}),
          execute: async () => {
            this.broadcast(JSON.stringify({ type: "voice-deactivate"}))
            return { success: true}
          }
        })
      },
      stopWhen: stepCountIs(10),
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
