# AI Answering Service

Multi-tenant SaaS that gives boutique service businesses (barbershops, salons, etc.) an AI phone receptionist. See `ai-answeering-clerk-tech-spec.md` for the full product/tech spec.

This repo is the **Phase 1 scaffold**. It has two services:

- **Dashboard** (root) — Next.js 15 + Postgres + Auth.js. Owners sign in here, manage services, see call logs and appointments.
- **Voice service** (`voice-service/`) — Node + Hono + Anthropic Claude. Handles inbound Twilio calls via ConversationRelay's WebSocket protocol.

Both services share one Postgres database and one Prisma schema (lives at `prisma/schema.prisma`).

## Why two services

Next.js App Router doesn't host WebSocket endpoints. Twilio ConversationRelay is a WebSocket protocol. So the call-handling code runs in a separate process. They share the database, the schema, and the multi-tenant model — they don't share a process.

## What's done

Dashboard:
- Next.js 15 + TypeScript + Tailwind + shadcn-style UI
- Postgres schema (Prisma) for every table in the spec
- Row-level security policies — every per-tenant query goes through `withTenant(tenantId, ...)` which sets `app.current_tenant` inside a transaction
- Auth.js v5 with Credentials provider, JWT sessions, tenant + role on the session
- Middleware-protected dashboard with all 7 pages (overview, calendar, services, calls, appointments, settings, billing) wired to real DB queries
- Docker Compose for local Postgres
- Seed script that creates a demo tenant (`Miami Cuts`) with a barbershop catalog and an OWNER login
- AES-256-GCM helper for encrypting per-tenant secrets

Voice service:
- Hono server on port 4000
- HTTP `/voice/incoming` endpoint that returns TwiML pointing at the WS endpoint, with tenantId injected via `<Parameter>`
- WebSocket `/cr` endpoint implementing Twilio ConversationRelay's full message protocol (setup, prompt, interrupt, dtmf, error)
- Anthropic Claude streaming loop with tool use
- Five LLM tools: `get_services`, `check_availability`, `book_appointment`, `cancel_appointment`, `switch_language`
- Per-tenant system prompt loaded at session setup, with the services catalog injected and explicit Spanglish behavior instructions
- Call logs persisted to Postgres on WS close
- Twilio signature validation on inbound webhooks

## What's NOT done

| Phase | Work | External requirements |
|---|---|---|
| 2 | Services CRUD (create/edit/delete from the UI) | None — pure code |
| 3 | Google Calendar OAuth + freebusy + event creation | Google Cloud project, OAuth consent verified by Google |
| 4 | Twilio number provisioning (purchase via API, auto-insert into `phone_numbers`) | Twilio account, billing on |
| 5 | End-to-end real call → real booking → real calendar event | All of phases 3 + 4 actually working |
| 6 | Spanglish prompt tuning + eval battery | Recorded Miami-accent test calls, eval harness |
| 7 | Stripe billing, usage metering, onboarding polish | Stripe account |

The voice service can take a real call right now. What's stubbed is `check_availability` (synthetic slots until Google Calendar lands) and the calendar event creation in `book_appointment` (writes the DB row but not the calendar event). The AI will book against the DB but the business owner won't see it on their physical Google Calendar until Phase 3.

## Why this stack

- **Twilio ConversationRelay** instead of Twilio AI Assistants. AI Assistants is still in alpha as of writing; ConversationRelay is the production-grade voice AI product. With ConversationRelay we bring our own LLM, which means we control the model selection — critical for the Spanglish requirement which is THE differentiator. AI Assistants would have locked us into whatever model Twilio chose.
- **Anthropic Claude Sonnet** for the brain. Strong multilingual including Spanglish, good tool calling, competitive pricing. Swappable via `ANTHROPIC_MODEL` env var.
- **Auth.js** instead of Clerk. Spec said "Clerk or Auth.js"; Auth.js doesn't require any external account to boot, and our `users.tenant_id` model doesn't need Clerk's org features.
- **Prisma + Postgres RLS**. Prisma manages the schema; RLS is the safety net so application-code mistakes don't leak data across tenants.

## Setup (local)

You need: Node 20+, Docker, an Anthropic API key, a Twilio account, and ngrok if you want to test real calls.

```bash
# --- 1. Dashboard ---
cd ai-answering-service          # repo root (the Next.js app lives here)
npm install
docker compose up -d
cp .env.example .env
echo "AUTH_SECRET=\"$(openssl rand -base64 32)\"" >> .env
echo "TENANT_SECRETS_KEY=\"$(openssl rand -base64 32)\"" >> .env
npm run db:migrate
npm run db:seed
npm run dev                      # starts on :3000
```

Sign in at http://localhost:3000/signin with `owner@miamicuts.test` / `barbershop123`.

```bash
# --- 2. Voice service ---
cd voice-service
npm install
npm run db:generate              # generates Prisma client against ../prisma/schema.prisma
cp .env.example .env
# Set ANTHROPIC_API_KEY, TWILIO_AUTH_TOKEN, and SKIP_TWILIO_SIGNATURE_CHECK=true
npm run dev                      # starts on :4000
```

```bash
# --- 3. Expose voice service to Twilio (separate terminal) ---
ngrok http 4000
# Take the https://<id>.ngrok-free.app URL.
# - In voice-service/.env set PUBLIC_HOST=<id>.ngrok-free.app (no scheme).
# - In Twilio console, set your phone number's voice webhook to
#   https://<id>.ngrok-free.app/voice/incoming (HTTP POST).
# Restart the voice service after editing .env.
```

```bash
# --- 4. Wire your Twilio number to the demo tenant (manual for now) ---
docker compose exec postgres psql -U postgres -d ai_answering -c \
  "INSERT INTO phone_numbers (id, tenant_id, twilio_sid, number, created_at) \
   VALUES ('phntest1', (SELECT id FROM tenants WHERE slug='miami-cuts'), \
           'PN_manual', '+1YOURTWILIONUMBER', NOW());"
```

Now call your Twilio number. You should hear the greeting from `voice-service/src/twiml.ts`.

## RLS — read this once

Postgres row-level security is the safety net for multi-tenant data isolation. The application code is the first line of defense; RLS catches mistakes.

Two ways to query:

1. **`withTenant(tenantId, async (db) => db.service.findMany())`** wraps the query in a transaction that runs `SET LOCAL app.current_tenant = '<tenantId>'`. RLS policies match this against `tenant_id` columns and scope every read/write. Use this for ALL request-scoped queries.

2. **`dbAdmin`** (raw Prisma client) — no tenant context. Use only for: auth lookups (find user by email before we know their tenant), Twilio webhook lookups (find tenant by called number — that's how we know which tenant), migrations, seed.

**RLS doesn't actually fire in local dev** because the `postgres` superuser bypasses it. **In production you MUST configure a non-privileged role** — see the comments in `prisma/migrations/.../enable_rls/migration.sql` for the exact `CREATE ROLE app_user` setup. Both services' `DATABASE_URL` should point at `app_user`. Migrations and seed continue running as `postgres`.

If you forget `withTenant()` in production, queries silently return zero rows. That's the safety net biting — fix the call site.

## File map

```
ai-answering-service/                       repo root (Next.js dashboard)
  prisma/
    schema.prisma                           shared between both services
    migrations/                             init + RLS enable
    seed.ts                                 demo tenant + barbershop catalog
  src/                                      Next.js dashboard
    auth.ts                                 Auth.js v5 config
    middleware.ts                           Auth.js middleware
    lib/
      db.ts                                 dbAdmin + withTenant()
      tenant.ts                             session + Twilio-number tenant lookup
      encryption.ts                         AES-256-GCM
    components/
    app/
      signin/page.tsx
      (dashboard)/                          7 pages
      api/auth/[...nextauth]/
  voice-service/                            voice arm
    src/
      index.ts                              Hono HTTP + WS server
      twiml.ts                              inbound-call TwiML builder
      conversation-relay.ts                 ConversationRelay WS protocol
      llm.ts                                Claude streaming + tool dispatch loop
      tools.ts                              5 LLM tool definitions and handlers
      prompts.ts                            per-tenant system prompt builder
      session.ts                            per-call state
      db.ts                                 same withTenant pattern as dashboard
      twilio-signature.ts                   X-Twilio-Signature validation
    README.md                               voice-service-specific docs
```

## Honest caveats

- The dashboard pages render data but most don't let you mutate it yet (e.g. Services has no "new service" form). Adding the forms is straightforward — wasn't part of the Phase 1 cut.
- Sign-up isn't built. The seed is the only way to create users today. Add a sign-up flow when you're ready to onboard a real second tenant.
- No tests anywhere. For a project that handles people's appointments and money, the next thing to add — before any Google Calendar / billing work — is at minimum integration tests around the voice tools and RLS scoping.
- I did not run `npm install` in either service in the build session, so the first run on your machine will pull packages and may surface version drift. If something errors, paste the output back and we'll fix it.
- The voice service's interruption handling is correct in shape (we cancel in-flight Claude streams when `interrupt` arrives) but real-world barge-in feels different from synthetic testing. Plan to record a few real calls and tune.
