# voice-service

The voice arm of the AI Answering Service. Lives next to the Next.js dashboard in the same repo, runs as a separate Node process.

Owns:
- The HTTP webhook Twilio hits when a call comes in (returns TwiML)
- The WebSocket endpoint Twilio's ConversationRelay attaches to
- The Anthropic Claude streaming loop that drives the conversation
- All five "tools" the LLM can call mid-conversation (services, availability, book, cancel, language switch)

Does not own:
- The dashboard, auth, or any tenant-management UI — that's the Next.js app at the repo root
- The Postgres schema — defined in `../prisma/schema.prisma`. We share Prisma client by running `prisma generate` against that schema.

## Why a separate service

Next.js App Router doesn't support WebSocket route handlers. ConversationRelay is a WebSocket protocol. So this lives in its own Node + Hono process.

## Architecture

```
Caller dials a Twilio number
    │
    ▼
Twilio POSTs /voice/incoming
    │
    │  We respond with TwiML:
    │    <Connect><ConversationRelay url="wss://.../cr">
    │      <Parameter name="tenantId" value="..."/>
    │    </ConversationRelay></Connect>
    ▼
Twilio opens WebSocket to /cr
    │
    │  Setup → we load tenant's system prompt + services
    │  Prompt → Claude streams text back, calls tools as needed
    │  Interrupt → we cancel in-flight stream
    ▼
Call ends → we persist call_logs row
```

Tenant resolution: the called Twilio number maps to one row in `phone_numbers`, which gives us a `tenant_id`. That id rides on `<Parameter name="tenantId">` and arrives in the WS setup message under `customParameters.tenantId`. From there every DB call uses `withTenant()` so RLS scopes everything.

## Setup (local)

```bash
# from voice-service/
npm install
npm run db:generate           # runs prisma generate against ../prisma/schema.prisma

cp .env.example .env
# Fill in:
#   ANTHROPIC_API_KEY=sk-ant-...
#   TWILIO_AUTH_TOKEN=...      (from your Twilio console)
#   PUBLIC_HOST=<your-ngrok-host>.ngrok-free.app
#   SKIP_TWILIO_SIGNATURE_CHECK=true   (for local dev only)

# Start postgres (from repo root, if it isn't already)
docker compose up -d
# Run migrations and seed (also from repo root)
npm run db:migrate
npm run db:seed

# Start the voice service
npm run dev
```

Then in a second terminal, expose this port to the public internet so Twilio can reach it:

```bash
ngrok http 4000
```

Take the `https://<id>.ngrok-free.app` host (just the hostname, no scheme) and:
1. Set `PUBLIC_HOST` in `.env` and restart the dev server.
2. In your Twilio console, configure the phone number's voice webhook to `https://<id>.ngrok-free.app/voice/incoming` (HTTP POST).
3. Make sure that number exists in the `phone_numbers` table for the tenant you want it pointed at. Phase 4 will provision this programmatically; for now, insert manually:

   ```sql
   INSERT INTO phone_numbers (id, tenant_id, twilio_sid, number, created_at)
   VALUES ('phntest1', '<your_tenant_id>', 'PN_test', '+1XXXXXXXXXX', NOW());
   ```

Now call the Twilio number. You should hear "Hi, thanks for calling Miami Cuts. How can I help you today?"

## What works, what doesn't

Works:
- Inbound TwiML response with tenant resolution
- WebSocket ↔ Twilio message protocol (setup, prompt, interrupt, dtmf, error)
- Claude streaming with tool calls, history retention per session
- All five tools wired to real DB writes (book/cancel actually creates rows)
- Per-tenant system prompt with services catalog injected
- Spanglish behavior via `switch_language` tool
- Call log persisted to `call_logs` on WS close

Stubbed / not real yet:
- `check_availability` returns synthetic hourly slots — it does NOT consult Google Calendar yet (Phase 3). The AI will happily "book" slots that conflict with real calendar events.
- `book_appointment` writes to the DB but does NOT create a Google Calendar event (Phase 3). The business owner won't see AI bookings on their actual calendar.
- Twilio signature validation works in production but `SKIP_TWILIO_SIGNATURE_CHECK=true` in dev. Don't deploy with this set.
- Phone number provisioning is manual — `phone_numbers` rows are inserted by hand. Phase 4 wires the Twilio API for purchase + auto-insert.

## Tuning notes

The Spanglish behavior lives in `src/prompts.ts`. The default prompt tells Claude to follow the caller's language sentence-by-sentence and never announce switches. If callers complain about robotic switching or the AI leading them in English, that prompt is the first thing to edit. The eval battery (Phase 6) is what actually tells you whether your prompt changes are improving anything.

The LLM model is configurable via `ANTHROPIC_MODEL`. Default is `claude-sonnet-4-6`. For cost-sensitive testing, swap to `claude-haiku-4-5-20251001`.

## Deploy (Railway)

Two services in one repo:
- `web` — root, runs Next.js
- `voice` — this folder, runs `node dist/index.js`

Railway-side: create a service for each, point the second at this folder via `Root Directory: voice-service`. Both services need the same `DATABASE_URL`. The voice service additionally needs `ANTHROPIC_API_KEY`, `TWILIO_AUTH_TOKEN`, and `PUBLIC_HOST` (set to the voice service's Railway domain).

WebSocket support on Railway is automatic — just expose the port the service binds to.
