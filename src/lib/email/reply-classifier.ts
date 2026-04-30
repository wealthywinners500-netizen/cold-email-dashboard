import Anthropic from '@anthropic-ai/sdk';

// Lazy init — never at module scope (Hard Lesson #34)
let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  return anthropicClient;
}

export type Classification =
  | 'INTERESTED'
  | 'HOT_LEAD'
  | 'NOT_INTERESTED'
  | 'OBJECTION'
  | 'AUTO_REPLY'
  | 'BOUNCE'
  | 'STOP'
  | 'SPAM';

export interface ClassificationResult {
  classification: Classification;
  confidence: number;
}

const SYSTEM_PROMPT = `You are an email reply classifier for a B2B cold email campaign. Classify the email reply into exactly ONE category:

- INTERESTED: The recipient asks for general info or pricing, but does NOT ask substantive qualifying questions. First-touch soft positive.
- HOT_LEAD: The recipient asks specific qualifying questions about pricing depth, contract terms, turnaround time, typical clients, decision-makers, or next steps. Engaged with substance, ready for direct follow-up.
- NOT_INTERESTED: The recipient declines politely but does not ask to be removed
- OBJECTION: The recipient raises a concern or objection but hasn't fully declined (budget, timing, authority, need)
- AUTO_REPLY: Out-of-office, vacation, auto-responder, delivery notification, read receipt
- BOUNCE: Hard bounce, invalid address, mailbox full, domain not found
- STOP: Unsubscribe request, "remove me", "stop emailing", threatening legal action, hostile response
- SPAM: Spam filter notification, flagged as spam, marked as junk

Respond with ONLY a JSON object: {"classification": "CATEGORY", "confidence": 0.0-1.0}

Respond with ONLY a JSON object on a single line. Do not wrap in markdown fences. Do not include any prose.`;

/**
 * Classify a single email reply using Claude Haiku
 * Cost: ~$0.0003 per classification
 */
export async function classifyReply(
  replyText: string,
  subjectLine?: string
): Promise<ClassificationResult> {
  const client = getAnthropic();

  const userMessage = subjectLine
    ? `Subject: ${subjectLine}\n\nBody:\n${replyText}`
    : replyText;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Parse response
  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    let parseInput = text.trim();
    const fenceMatch = parseInput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) parseInput = fenceMatch[1].trim();
    const result = JSON.parse(parseInput);
    return {
      classification: result.classification as Classification,
      confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
    };
  } catch {
    console.error('[Classifier] Failed to parse response:', text);
    return { classification: 'AUTO_REPLY', confidence: 0.3 };
  }
}

// Batching is handled at the worker layer (src/worker/handlers/sync-inbox.ts)
// where the empty-text short-circuit + rate-limit pacing live alongside the
// per-message persistence + sequence-engine wiring.
