// Per-call session state.
//
// One instance per active WebSocket connection. Holds the tenant context,
// conversation history (for the LLM), and a few flags we use to short-circuit
// races between user interruptions and in-flight LLM responses.

import type Anthropic from "@anthropic-ai/sdk";

export type Session = {
  /** ConversationRelay's session id. */
  sessionId: string;
  tenantId: string;
  callSid: string;
  caller: string;
  startedAt: Date;
  /** Anthropic message history (alternating user/assistant). */
  history: Anthropic.MessageParam[];
  /** True once we've sent the first response. */
  hasGreeted: boolean;
  /** Cached system prompt, loaded at setup. */
  systemPrompt: string;
  /** Set true when the user interrupts; in-flight token streams check this. */
  cancelInFlight: boolean;
};

export function newSession(args: {
  sessionId: string;
  tenantId: string;
  callSid: string;
  caller: string;
  systemPrompt: string;
}): Session {
  return {
    sessionId: args.sessionId,
    tenantId: args.tenantId,
    callSid: args.callSid,
    caller: args.caller,
    startedAt: new Date(),
    history: [],
    hasGreeted: false,
    systemPrompt: args.systemPrompt,
    cancelInFlight: false,
  };
}
