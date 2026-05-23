// Voice service entry point.
//
// HTTP:
//   POST /voice/incoming        Twilio's voice webhook → returns TwiML
//   POST /voice/status          Twilio's call status callback (optional)
//   GET  /healthz               for Railway / load-balancer healthchecks
//
// WebSocket:
//   /cr                         ConversationRelay attaches here
//
// Run with `npm run dev` (tsx watch). For local end-to-end testing you'll
// need ngrok pointing at this port — see voice-service/README.md.

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { buildHangupTwiml, buildIncomingTwiml, buildLanguageSelectedTwiml } from "./twiml.js";
import { ConversationRelayHandler } from "./conversation-relay.js";
import { verifyTwilioSignature } from "./twilio-signature.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const PORT = parseInt(process.env.PORT ?? "4000", 10);
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? "";

if (!PUBLIC_HOST) {
  console.warn(
    "[startup] PUBLIC_HOST not set — TwiML will advertise an empty WS URL",
  );
}

// --- HTTP routes ---

app.get("/healthz", (c) => c.text("ok"));

app.post("/voice/incoming", async (c) => {
  // Twilio posts application/x-www-form-urlencoded.
  const formData = await c.req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of formData.entries()) params[k] = String(v);

  const fullUrl = `https://${c.req.header("host")}${c.req.path}`;
  const sig = c.req.header("x-twilio-signature") ?? null;
  if (!verifyTwilioSignature({ signature: sig, url: fullUrl, params })) {
    console.warn("[/voice/incoming] bad signature, rejecting");
    return c.text("forbidden", 403);
  }

  const called = params.To ?? params.Called ?? "";
  const caller = params.From ?? "";
  const callSid = params.CallSid ?? "";

  const twiml = await buildIncomingTwiml(
    { called, caller, callSid },
    PUBLIC_HOST,
  );

  if (!twiml) {
    console.warn(`[/voice/incoming] unknown number ${called}`);
    return c.body(
      buildHangupTwiml(
        "We're sorry — this number isn't currently configured. Goodbye.",
      ),
      200,
      { "content-type": "text/xml" },
    );
  }

  return c.body(twiml, 200, { "content-type": "text/xml" });
});

app.post("/voice/language", async (c) => {
  const formData = await c.req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of formData.entries()) params[k] = String(v);

  const fullUrl = `https://${c.req.header("host")}${c.req.path}`;
  const sig = c.req.header("x-twilio-signature") ?? null;
  if (!verifyTwilioSignature({ signature: sig, url: fullUrl, params })) {
    console.warn("[/voice/language] bad signature, rejecting");
    return c.text("forbidden", 403);
  }

  const called = params.To ?? params.Called ?? "";
  const caller = params.From ?? "";
  const callSid = params.CallSid ?? "";
  const digit = params.Digits ?? "";

  const twiml = await buildLanguageSelectedTwiml(
    { called, caller, callSid, digit },
    PUBLIC_HOST,
  );

  if (!twiml) {
    console.warn(`[/voice/language] unknown number ${called}`);
    return c.body(
      buildHangupTwiml("We're sorry — this number isn't configured. Goodbye."),
      200,
      { "content-type": "text/xml" },
    );
  }

  return c.body(twiml, 200, { "content-type": "text/xml" });
});

app.post("/voice/status", async (c) => {
  // Twilio fires this on call status changes (queued, ringing, answered,
  // completed). We persist call_logs in the WS handler's onClose, so this
  // is just an ack endpoint for now.
  // TODO: dedupe with WS-side persistence; this webhook is the more reliable
  // source for final duration when calls drop unexpectedly.
  return c.text("");
});

// --- WebSocket route ---

app.get(
  "/cr",
  upgradeWebSocket(() => {
    let handler: ConversationRelayHandler | null = null;
    return {
      onOpen(_evt, ws) {
        handler = new ConversationRelayHandler(ws);
        console.log("[cr] ws open");
      },
      async onMessage(evt) {
        if (!handler) return;
        await handler.onMessage(evt.data);
      },
      async onClose() {
        if (handler) {
          await handler.onClose();
          handler = null;
        }
        console.log("[cr] ws close");
      },
      onError(err) {
        console.error("[cr] ws error", err);
      },
    };
  }),
);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[startup] voice service on :${info.port}`);
});

injectWebSocket(server);
