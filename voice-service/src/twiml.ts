// TwiML response builder for the inbound call webhook.
//
// When Twilio receives a call, it POSTs to /voice/incoming. We respond with
// TwiML that says "open a WebSocket to my voice service and speak this
// greeting." The tenantId travels as a custom Parameter and arrives in the
// ConversationRelay setup message — that's how the WS handler knows whose
// system prompt to load.

import { dbAdmin } from "./db.js";

export type IncomingCallParams = {
  called: string; // E.164, the number that was dialed
  caller?: string;
  callSid?: string;
};

/**
 * Builds the TwiML response for an inbound call.
 * Returns null if the called number isn't provisioned — the HTTP layer
 * should respond with TwiML that politely hangs up.
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

  const wsUrl = `wss://${publicHost}/cr`;
  const businessName = escapeXml(number.tenant.name);
  const greeting =
    `Thank you for calling ${businessName}. ` +
    `For English, press 1. Para español, oprima el 2.`;

  // ConversationRelay TwiML.
  //   - language="en-US": initial language. The LLM can switch mid-call via a
  //     tool call (see src/tools/language.ts).
  //   - transcriptionProvider/voice: leave at Twilio defaults for now;
  //     pick deliberately when tuning Spanglish quality.
  //   - <Parameter name="tenantId"> arrives in the WS setup message under
  //     customParameters.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${escapeXmlAttr(wsUrl)}"
      welcomeGreeting="${escapeXmlAttr(greeting)}"
      language="en-US"
      transcriptionProvider="google"
      voice="en-US-Neural2-F">
      <Parameter name="tenantId" value="${escapeXmlAttr(number.tenantId)}" />
      <Parameter name="callSid" value="${escapeXmlAttr(params.callSid ?? "")}" />
      <Parameter name="caller" value="${escapeXmlAttr(params.caller ?? "")}" />
    </ConversationRelay>
  </Connect>
</Response>`;
}

export function buildHangupTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(message)}</Say>
  <Hangup/>
</Response>`;
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
