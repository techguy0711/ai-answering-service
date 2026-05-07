// Tools the LLM can call during a conversation.
//
// Each tool has:
//   - a `definition` for Anthropic's tool-use API
//   - a `handler` that runs the actual side effect (DB write, etc.)
//
// Handlers receive the per-call session (which carries the tenantId from
// ConversationRelay's customParameters). All DB access goes through
// withTenant() so RLS scopes everything.

import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { withTenant } from "./db.js";
import type { Session } from "./session.js";

export type ToolHandler = (
  session: Session,
  input: any,
) => Promise<{
  /** Result returned to the LLM as the tool result. */
  result: unknown;
  /** Optional message to send to ConversationRelay (e.g. switch_language). */
  conversationRelayMessage?: Record<string, unknown>;
}>;

export type ToolDefinition = {
  definition: Anthropic.Tool;
  handler: ToolHandler;
};

export const tools: Record<string, ToolDefinition> = {
  get_services: {
    definition: {
      name: "get_services",
      description:
        "Get the list of services this business offers. Returns name, duration in minutes, and price in dollars. Call this if you need to remind yourself of the catalog mid-call.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    async handler(session) {
      const services = await withTenant(
        session.tenantId,
        (db: Prisma.TransactionClient) =>
          db.service.findMany({
            where: { active: true },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              durationMinutes: true,
              priceCents: true,
            },
          }),
      );
      return {
        result: {
          services: services.map((s) => ({
            id: s.id,
            name: s.name,
            duration_minutes: s.durationMinutes,
            price_usd: (s.priceCents / 100).toFixed(2),
          })),
        },
      };
    },
  },

  check_availability: {
    definition: {
      name: "check_availability",
      description:
        "Find open appointment slots for a given service in a date range. Returns up to 10 slots. Read 2-3 to the caller, don't dump the whole list.",
      input_schema: {
        type: "object",
        properties: {
          service_id: { type: "string" },
          start_date: {
            type: "string",
            description:
              "ISO date or datetime, start of the window the caller is asking about (e.g. 'tomorrow morning' → tomorrow 09:00 local).",
          },
          end_date: {
            type: "string",
            description: "ISO date or datetime, end of the window.",
          },
        },
        required: ["service_id", "start_date", "end_date"],
      },
    },
    async handler(session, input: {
      service_id: string;
      start_date: string;
      end_date: string;
    }) {
      const service = await withTenant(
        session.tenantId,
        (db: Prisma.TransactionClient) =>
          db.service.findFirst({
            where: { id: input.service_id, active: true },
          }),
      );
      if (!service) return { result: { error: "unknown_service" } };

      // STUB: hourly slots within the requested window during 9-18 local.
      // TODO Phase 3: replace with Google Calendar freebusy intersection.
      const start = new Date(input.start_date);
      const end = new Date(input.end_date);
      const slots: { start: string; end: string }[] = [];
      const cursor = new Date(start);
      while (cursor < end && slots.length < 10) {
        const hour = cursor.getHours();
        if (hour >= 9 && hour < 18) {
          const slotEnd = new Date(
            cursor.getTime() + service.durationMinutes * 60_000,
          );
          slots.push({
            start: cursor.toISOString(),
            end: slotEnd.toISOString(),
          });
        }
        cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      }
      return {
        result: {
          slots,
          _note: "STUB — synthetic slots until Google Calendar is wired up",
        },
      };
    },
  },

  book_appointment: {
    definition: {
      name: "book_appointment",
      description:
        "Create an appointment. Use AFTER you've confirmed name, time, and service with the caller. Returns the booking confirmation id.",
      input_schema: {
        type: "object",
        properties: {
          service_id: { type: "string" },
          start_time: {
            type: "string",
            description: "ISO datetime of the slot the caller picked.",
          },
          customer_name: { type: "string" },
          customer_phone: {
            type: "string",
            description:
              "E.164 if you have it; otherwise the digits the caller spoke. The system stores it as-is.",
          },
        },
        required: [
          "service_id",
          "start_time",
          "customer_name",
          "customer_phone",
        ],
      },
    },
    async handler(session, input: {
      service_id: string;
      start_time: string;
      customer_name: string;
      customer_phone: string;
    }) {
      return withTenant(session.tenantId, async (db: Prisma.TransactionClient) => {
        const service = await db.service.findFirst({
          where: { id: input.service_id, active: true },
        });
        if (!service) return { result: { error: "unknown_service" } };

        const start = new Date(input.start_time);
        const end = new Date(start.getTime() + service.durationMinutes * 60_000);

        // TODO Phase 3: create Google Calendar event first; only insert the
        // DB row if the calendar insert succeeds. Otherwise we'll get
        // double-bookings via manual events.
        const appointment = await db.appointment.create({
          data: {
            tenantId: session.tenantId,
            serviceId: service.id,
            customerName: input.customer_name,
            customerPhone: input.customer_phone,
            startTime: start,
            endTime: end,
            status: "CONFIRMED",
            source: "AI",
            googleEventId: null,
          },
        });
        return {
          result: {
            appointment_id: appointment.id,
            confirmation: `Booked ${service.name} for ${input.customer_name} on ${start.toISOString()}.`,
          },
        };
      });
    },
  },

  cancel_appointment: {
    definition: {
      name: "cancel_appointment",
      description:
        "Cancel an upcoming appointment by phone number, optionally narrowed by start time. If start_time is omitted, cancels the next upcoming.",
      input_schema: {
        type: "object",
        properties: {
          customer_phone: { type: "string" },
          start_time: {
            type: "string",
            description: "Optional ISO datetime to disambiguate.",
          },
        },
        required: ["customer_phone"],
      },
    },
    async handler(session, input: {
      customer_phone: string;
      start_time?: string;
    }) {
      return withTenant(session.tenantId, async (db: Prisma.TransactionClient) => {
        const target = await db.appointment.findFirst({
          where: {
            customerPhone: input.customer_phone,
            status: "CONFIRMED",
            ...(input.start_time
              ? { startTime: new Date(input.start_time) }
              : { startTime: { gte: new Date() } }),
          },
          orderBy: { startTime: "asc" },
          include: { service: true },
        });
        if (!target) return { result: { error: "no_appointment_found" } };

        await db.appointment.update({
          where: { id: target.id },
          data: { status: "CANCELED" },
        });
        return {
          result: {
            appointment_id: target.id,
            confirmation: `Canceled ${target.service.name} on ${target.startTime.toISOString()}.`,
          },
        };
      });
    },
  },

  switch_language: {
    definition: {
      name: "switch_language",
      description:
        "Tell the speech synthesizer to switch language. Use SILENTLY when the caller switches between English and Spanish. Don't announce the switch — just match them.",
      input_schema: {
        type: "object",
        properties: {
          language: {
            type: "string",
            description:
              "BCP-47 code: 'en-US' or 'es-US' for Miami Spanish.",
            enum: ["en-US", "es-US", "es-MX"],
          },
        },
        required: ["language"],
      },
    },
    async handler(_session, input: { language: string }) {
      // Returns a ConversationRelay 'language' message — emitted on the
      // WebSocket to actually change voices/STT.
      return {
        result: { ok: true, language: input.language },
        conversationRelayMessage: {
          type: "language",
          ttsLanguage: input.language,
          transcriptionLanguage: input.language,
        },
      };
    },
  },
};

export const toolDefinitions: Anthropic.Tool[] = Object.values(tools).map(
  (t) => t.definition,
);

export async function dispatchTool(
  name: string,
  input: any,
  session: Session,
): Promise<ReturnType<ToolHandler>> {
  const tool = tools[name];
  if (!tool) {
    return { result: { error: `unknown_tool: ${name}` } };
  }
  try {
    return await tool.handler(session, input);
  } catch (err) {
    console.error(`[tool ${name}] error`, err);
    return {
      result: { error: "tool_failed", message: String(err) },
    };
  }
}
