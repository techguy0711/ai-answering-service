// Anthropic streaming loop with tool use.
//
// We stream the assistant's text response back to ConversationRelay token by
// token (the WS sends each chunk as a `text` message with `last: false`,
// then a final `last: true`). When the model issues tool_use blocks, we
// drain the stream, run the tools, append tool_result blocks, and ask the
// model again.
//
// This implementation is single-threaded per session — we don't issue tool
// calls in parallel within a single turn (Anthropic supports it; we don't
// need it yet and serial is easier to reason about).

import Anthropic from "@anthropic-ai/sdk";
import type { Session } from "./session.js";
import { dispatchTool, toolDefinitions } from "./tools.js";

// Local discriminated union for the assistant content blocks we construct
// when appending to history. Using SDK-internal request types directly is
// brittle across @anthropic-ai/sdk versions; this is the surface we care
// about and matches what MessageParam.content accepts.
type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 6;

export type LlmCallbacks = {
  /** Stream a text token to the caller. Called many times per turn. */
  onText: (text: string) => void;
  /** Marks the end of the assistant's spoken turn. */
  onTurnEnd: () => void;
  /** Forward a ConversationRelay control message (e.g. switch_language). */
  onConversationRelayMessage: (msg: Record<string, unknown>) => void;
};

/**
 * Run one turn: take the user's utterance, push it through Claude, stream
 * back text, run any tool calls, and signal turn end.
 */
export async function runTurn(
  session: Session,
  userText: string,
  cbs: LlmCallbacks,
): Promise<void> {
  session.history.push({ role: "user", content: userText });

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    if (session.cancelInFlight) {
      session.cancelInFlight = false;
      return;
    }

    let collectedText = "";
    const collectedToolUses: {
      id: string;
      name: string;
      input: any;
    }[] = [];
    let stopReason: string | null = null;

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: session.systemPrompt,
      tools: toolDefinitions,
      messages: session.history,
    });

    let currentToolUse: {
      id: string;
      name: string;
      jsonChunks: string[];
    } | null = null;

    for await (const event of stream) {
      if (session.cancelInFlight) break;

      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            jsonChunks: [],
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          collectedText += event.delta.text;
          cbs.onText(event.delta.text);
        } else if (event.delta.type === "input_json_delta") {
          if (currentToolUse) {
            currentToolUse.jsonChunks.push(event.delta.partial_json);
          }
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolUse) {
          let parsed: any = {};
          const raw = currentToolUse.jsonChunks.join("");
          if (raw.length > 0) {
            try {
              parsed = JSON.parse(raw);
            } catch (err) {
              console.error(
                `[llm] failed to parse tool input for ${currentToolUse.name}:`,
                raw,
                err,
              );
            }
          }
          collectedToolUses.push({
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: parsed,
          });
          currentToolUse = null;
        }
      } else if (event.type === "message_delta") {
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
      }
    }

    if (session.cancelInFlight) {
      session.cancelInFlight = false;
      // Don't end the turn — the user is in the middle of a new utterance.
      return;
    }

    // Assemble the assistant message we just produced and append to history.
    const assistantContent: AssistantContentBlock[] = [];
    if (collectedText.length > 0) {
      assistantContent.push({ type: "text", text: collectedText });
    }
    for (const tu of collectedToolUses) {
      assistantContent.push({
        type: "tool_use",
        id: tu.id,
        name: tu.name,
        input: tu.input,
      });
    }
    session.history.push({ role: "assistant", content: assistantContent });

    if (stopReason !== "tool_use" || collectedToolUses.length === 0) {
      // Final turn — flush.
      cbs.onTurnEnd();
      return;
    }

    // Run tools, append tool_result blocks, and loop.
    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of collectedToolUses) {
      const out = await dispatchTool(tu.name, tu.input, session);
      if (out.conversationRelayMessage) {
        cbs.onConversationRelayMessage(out.conversationRelayMessage);
      }
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(out.result),
      });
    }
    session.history.push({ role: "user", content: toolResultBlocks });
  }

  // Tool-use loop budget exhausted. Bail with a fallback so we don't loop
  // forever or get charged a fortune.
  console.warn("[llm] hit MAX_TOOL_ITERATIONS, ending turn");
  cbs.onText("Sorry, I'm having trouble with that — let me have someone call you back. ");
  cbs.onTurnEnd();
}
