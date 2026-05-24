// TwiML response builder for the inbound call webhook.
//
// When Twilio receives a call, it POSTs to /voice/incoming. We respond with
// a <Gather> menu that asks the caller to choose a language. Twilio then
// POSTs the pressed digit to /voice/language, which responds with the real
// ConversationRelay TwiML using the correct voice for that language.
//
// The tenantId travels as a custom Parameter inside <ConversationRelay> and
// arrives in the WS setup message — that's how the handler knows whose
// system prompt to load.

import { dbAdmin } from "./db.js";
import { VOICE_FOR_LANGUAGE } from "./tools.js";

export type IncomingCallParams = {
  called: string; // E.164, the number that was dialed
  caller?: string;
  callSid?: string;
};

/**
 * Builds the initial TwiML for an inbound call.
 * Plays a bilingual language-selection prompt and waits for 1 digit.
 * Returns null if the called number isn't provisioned.
 */
export async function buildIncomingTwiml(
  params: IncomingCallParams,
  publicHost: string,
): Promise<string | null> {
  const number = await dbAdmin.phoneNumber.findUnique({
    where: { number: params.called },
    select: {
      tenantId: true,
      tenant: { select: { name: true } },
    },
  });
  if (!number) return null;

  const businessName = escapeXml(number.tenant.name);
  const gatherAction = escapeXmlAttr(`https://${publicHost}/voice/language`);

  // Timeout fallback (no key pressed within 3 s): start in English.
  const fallback = conversationRelayXml({
    publicHost,
    tenantId: number.tenantId,
    callSid: params.callSid ?? "",
    caller: params.caller ?? "",
    language: "en-US",
    greeting: `Thank you for calling ${businessName}. How can I help you today?`,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${gatherAction}" method="POST" timeout="3">
    <Say language="en-US">Thank you for calling ${businessName}. For Spanish, press star.</Say>
    <Say language="es-US">Para español, oprima la estrella.</Say>
  </Gather>
  ${fallback}
</Response>`;
}

/**
 * Builds ConversationRelay TwiML after the caller has pressed a language key.
 * Called from the /voice/language route with the same DB lookup pattern.
 */
export async function buildLanguageSelectedTwiml(
  params: { called: string; caller: string; callSid: string; digit: string },
  publicHost: string,
): Promise<string | null> {
  const number = await dbAdmin.phoneNumber.findUnique({
    where: { number: params.called },
    select: {
      tenantId: true,
      tenant: { select: { name: true } },
    },
  });
  if (!number) return null;

  const language = params.digit === "*" ? "es-US" : "en-US";
  const businessName = number.tenant.name;
  const greeting =
    language === "es-US"
      ? `Gracias por llamar a ${escapeXml(businessName)}. ¿En qué le puedo ayudar hoy?`
      : `Thank you for calling ${escapeXml(businessName)}. How can I help you today?`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${conversationRelayXml({
    publicHost,
    tenantId: number.tenantId,
    callSid: params.callSid,
    caller: params.caller,
    language,
    greeting,
  })}
</Response>`;
}

export function buildHangupTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(message)}</Say>
  <Hangup/>
</Response>`;
}

// --- helpers ---

function conversationRelayXml(opts: {
  publicHost: string;
  tenantId: string;
  callSid: string;
  caller: string;
  language: string;
  greeting: string;
}): string {
  const wsUrl = `wss://${opts.publicHost}/cr`;
  const voice = VOICE_FOR_LANGUAGE[opts.language] ?? "Google.en-US-Neural2-F";
  return `<Connect>
    <ConversationRelay
      url="${escapeXmlAttr(wsUrl)}"
      welcomeGreeting="${escapeXmlAttr(opts.greeting)}"
      language="${escapeXmlAttr(opts.language)}"
      transcriptionProvider="google"
      voice="${escapeXmlAttr(voice)}">
      <Parameter name="tenantId" value="${escapeXmlAttr(opts.tenantId)}" />
      <Parameter name="callSid" value="${escapeXmlAttr(opts.callSid)}" />
      <Parameter name="caller" value="${escapeXmlAttr(opts.caller)}" />
    </ConversationRelay>
  </Connect>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
