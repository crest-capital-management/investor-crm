import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude (Anthropic API) helper for the CRM's AI features.
 * Needs ANTHROPIC_API_KEY. Voice notes are the exception: Claude does not
 * take audio, so they stay on Gemini (lib/gemini.ts, GEMINI_API_KEY).
 */

const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000;

let client: Anthropic | null = null;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  // The SDK retries rate limits, overloads and connection errors itself.
  client ??= new Anthropic({ apiKey, maxRetries: 2 });
  return client;
}

export type AskClaudeOptions = {
  /** The prompt, plus an optional PDF to read alongside it. */
  prompt: string;
  pdf?: Buffer;
  /** When given, Claude must answer with JSON matching this schema. */
  jsonSchema?: Record<string, unknown>;
  /** "low" for short everyday tasks; "medium" for reading documents. */
  effort?: "low" | "medium" | "high";
  /** The whole call (with retries) gives up after this long. */
  timeoutMs?: number;
};

/** Sends one request to Claude and returns its text answer. */
export async function askClaude(options: AskClaudeOptions): Promise<string> {
  const anthropic = getClient();

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (options.pdf) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: options.pdf.toString("base64") },
    });
  }
  content.push({ type: "text", text: options.prompt });

  const signal = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined;

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await anthropic.beta.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // If Claude's safety checks wrongly decline a request, the API retries it
        // on a recommended fallback model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: options.effort ?? "low",
          ...(options.jsonSchema ? { format: { type: "json_schema", schema: options.jsonSchema } } : {}),
        },
        messages: [{ role: "user", content }],
      },
      { signal },
    );
  } catch (err: unknown) {
    if (signal?.aborted) throw new Error("The AI took too long to respond. Please try again.");
    if (err instanceof Anthropic.AuthenticationError) throw new Error("The Anthropic API key is not valid.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("The AI is busy right now. Please try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new Error(`AI request failed: ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined this request.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The AI's answer was cut off. Please try again.");
  }

  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new Error("The AI returned an empty answer.");
  return text;
}

/** Parses a JSON answer from Claude, with a clear error if it is not JSON. */
export function parseClaudeJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The AI returned an unexpected response format.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The AI returned an unexpected response format.");
  }
  return parsed as Record<string, unknown>;
}
