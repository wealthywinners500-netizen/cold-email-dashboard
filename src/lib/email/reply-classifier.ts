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

- INTERESTED: The recipient expresses interest, asks questions, requests more info, wants to meet/call, or asks for pricing
- NOT_INTERESTED: The recipient declines politely but does not ask to be removed
- OBJECTION: The recipient raises a concern or objection but hasn't fully declined (budget, timing, authority, need)
- AUTO_REPLY: Out-of-office, vacation, auto-responder, delivery notification, read receipt
- BOUNCE: Hard bounce, invalid address, mailbox full, domain not found
- STOP: Unsubscribe request, "remove me", "stop emailing", threatening legal action, hostile response
- SPAM: Spam filter notification, flagged as spam, marked as junk

Respond with ONLY a JSON object: {"classification": "CATEGORY", "confidence": 0.0-1.0}`;

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
    const result = JSON.parse(text.trim());
    return {
      classification: result.classification as Classification,
      confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
    };
  } catch {
    // If parsing fails, default to AUTO_REPLY with low confidence
    console.error('[Classifier] Failed to parse response:', text);
    return { classification: 'AUTO_REPLY', confidence: 0.3 };
  }
}

/**
 * Batch classify multiple replies
 * Uses sequential calls (Claude Batch API requires different setup)
 */
export async function classifyBatch(
  replies: { id: number; text: string; subject?: string }[]
): Promise<Map<number, ClassificationResult>> {
  const results = new Map<number, ClassificationResult>();

  // Process in parallel batches of 10 for speed
  const batchSize = 10;
  for (let i = 0; i < replies.length; i += batchSize) {
    const batch = replies.slice(i, i + batchSize);
    const promises = batch.map(async (reply) => {
      try {
        const result = await classifyReply(reply.text, reply.subject);
        results.set(reply.id, result);
      } catch (err) {
        console.error(`[Classifier] Error classifying message ${reply.id}:`, err);
        results.set(reply.id, { classification: 'AUTO_REPLY', confidence: 0.1 });
      }
    });
    await Promise.all(promises);
  }

  return results;
}
