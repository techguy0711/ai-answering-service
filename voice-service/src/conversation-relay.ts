// ConversationRelay WebSocket protocol handler.
//
// Twilio sends us:
//   - { type: 'setup', sessionId, callSid, customParameters: {...}, ... }
//     ONCE on connect.
//   - { type: 'prompt', voicePrompt: '...' } when the caller finishes a
//     spoken phrase (Twilio's STT gives us the final transcription).
//   - { type: 'interrupt', utteranceUntilInterrupt: '...' } when the caller
//     starts speaking while we're playing TTS.
//   - { type: 'dtmf', digit: '5' } if they press a key.
//   - { type: 'error', description } on errors.
//
// We send back:
//   - { type: 'text', token: '...', last: false } streaming each token.
//   - { type: 'text', token: '', last: true } to signal end of turn.
//   - { type: 'language', ttsLanguage, transcriptionLanguage } to switch.
//   - { type: 'end' } to hang up cleanly.
//
// Source: https://www.twilio.com/docs/voice/conversationrelay/websocket-messages

import type { WSContext } from "hono/ws";
import { loadSystemPrompt } from "./prompts.js";
import { runTurn } from "./llm.js";
import { newSession, type Session } from "./session.js";
import { dbAdmin, withTenant } from "./db.js";
import { VOICE_FOR_LANGUAGE } from "./tools.js";

type CrSetup = {
  type: "setup";
  sessionId: string;
  callSid: string;
  customParameters?: Record<string, string>;
};
type CrPrompt = {
  type: "prompt";
  voicePrompt: string;
  last?: boolean;
};
type CrInterrupt = {
  type: "interrupt";
  utteranceUntilInterrupt?: string;
};
type CrDtmf = { type: "dtmf"; digit: string };
type CrError = { type: "error"; description?: string };
type CrIncoming = CrSetup | CrPrompt | CrInterrupt | CrDtmf | CrError;

export class ConversationRelayHandler {
  private session: Session | null = null;
  private wsSendingClosed = false;

  constructor(private ws: WSContext) {}

  async onMessage(raw: string | ArrayBuffer | Blob): Promise<void> {
    const text = typeof raw === "string" ? raw : await rawToString(raw);
    let msg: CrIncoming;
    try {
      msg = JSON.parse(text);
    } catch {
      console.warn("[cr] non-JSON frame:", text.slice(0, 200));
      return;
    }

    switch (msg.type) {
      case "setup":
        await this.handleSetup(msg);
        break;
      case "prompt":
        await this.handlePrompt(msg);
        break;
      case "interrupt":
        this.handleInterrupt(msg);
        break;
      case "dtmf":
        await this.handleDtmf(msg);
        break;
      case "error":
        console.error("[cr] error from Twilio:", msg.description);
        break;
      default:
        console.warn("[cr] unknown message type:", (msg as any).type);
    }
  }

  async onClose(): Promise<void> {
    this.wsSendingClosed = true;
    if (!this.session) return;
    // Persist the call to call_logs. ConversationRelay's stop callback also
    // fires a separate Twilio status webhook — we'd dedupe via twilioCallSid
    // there. For now this is the only writer.
    const transcript = this.session.history
      .map((m) => {
        const role = m.role;
        const content =
          typeof m.content === "string"
            ? m.content
            : m.content
                .map((b: any) => (b.type === "text" ? b.text : ""))
                .join("")
                .trim();
        return `${role}: ${content}`;
      })
      .filter((line) => !line.endsWith(": "))
      .join("\n");

    try {
      await withTenant(this.session.tenantId, (db) =>
        db.callLog.upsert({
          where: { twilioCallSid: this.session!.callSid },
          create: {
            tenantId: this.session!.tenantId,
            twilioCallSid: this.session!.callSid,
            startedAt: this.session!.startedAt,
            durationSeconds: Math.round(
              (Date.now() - this.session!.startedAt.getTime()) / 1000,
            ),
            transcript,
            outcome: "completed",
          },
          update: {
            transcript,
            durationSeconds: Math.round(
              (Date.now() - this.session!.startedAt.getTime()) / 1000,
            ),
          },
        }),
      );
    } catch (err) {
      console.error("[cr] failed to persist call log", err);
    }
  }

  // --- handlers ---

  private async handleSetup(msg: CrSetup): Promise<void> {
    const tenantId = msg.customParameters?.tenantId;
    const callSid = msg.callSid ?? msg.customParameters?.callSid ?? "";
    const caller = msg.customParameters?.caller ?? "";

    if (!tenantId) {
      console.error("[cr] setup without tenantId — closing");
      this.send({ type: "end" });
      return;
    }

    // Confirm the tenant still exists. If the row was deleted between
    // TwiML response and WS connect, fail gracefully.
    const tenant = await dbAdmin.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      console.error("[cr] tenant not found", tenantId);
      this.send({ type: "end" });
      return;
    }

    const systemPrompt = await loadSystemPrompt(tenantId);
    this.session = newSession({
      sessionId: msg.sessionId,
      tenantId,
      callSid,
      caller,
      systemPrompt,
    });

    console.log(
      `[cr] session ${msg.sessionId} setup for tenant ${tenantId} call ${callSid}`,
    );
    // We don't speak first — the welcomeGreeting in TwiML handles that.
  }

  private async handleDtmf(msg: CrDtmf): Promise<void> {
    if (!this.session || this.session.phase !== "language_select") return;

    if (msg.digit === "1") {
      this.session.phase = "ready";
      this.send({ type: "text", token: "Thank you! How can I help you today?", last: false });
      this.send({ type: "text", token: "", last: true });
    } else if (msg.digit === "2") {
      this.session.phase = "ready";
      this.send({ type: "language", ttsLanguage: "es-US", transcriptionLanguage: "es-US", voice: VOICE_FOR_LANGUAGE["es-US"] });
      this.send({ type: "text", token: "¡Gracias! ¿En qué le puedo ayudar hoy?", last: false });
      this.send({ type: "text", token: "", last: true });
    } else {
      this.send({ type: "text", token: "Para inglés, oprima el 1. Para español, oprima el 2.", last: false });
      this.send({ type: "text", token: "", last: true });
    }
  }

  private async handlePrompt(msg: CrPrompt): Promise<void> {
    if (!this.session) {
      console.warn("[cr] prompt before setup");
      return;
    }
    if (msg.voicePrompt.trim().length === 0) return;

    // Caller spoke instead of pressing a key — advance past language selection.
    this.session.phase = "ready";

    await runTurn(this.session, msg.voicePrompt, {
      onText: (token) => {
        this.send({ type: "text", token, last: false });
      },
      onTurnEnd: () => {
        this.send({ type: "text", token: "", last: true });
      },
      onConversationRelayMessage: (m) => {
        this.send(m);
      },
    });
  }

  private handleInterrupt(_msg: CrInterrupt): void {
    if (!this.session) return;
    this.session.cancelInFlight = true;
    // Twilio already stopped TTS playback when the user spoke. We just need
    // to halt the in-flight stream so we don't keep generating text the
    // user will never hear.
  }

  private send(payload: Record<string, unknown>): void {
    if (this.wsSendingClosed) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error("[cr] ws send failed", err);
    }
  }
}

async function rawToString(raw: ArrayBuffer | Blob): Promise<string> {
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.text();
}
