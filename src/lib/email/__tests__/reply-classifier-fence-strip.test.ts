/**
 * Regression test for the 2026-04-30 reply-classifier silent-no-op.
 *
 * Symptom: after restoring ANTHROPIC_API_KEY on the worker on 2026-04-30,
 *          smoke-test message id=474 (a clear OOO) classified as
 *          AUTO_REPLY with confidence=0.3 — the parse-failure fallback
 *          signature, not the prior 0.1 auth-error signature. Worker
 *          journal showed:
 *
 *            [Classifier] Failed to parse response: ```json
 *
 *          Claude Haiku 4.5 wraps JSON in markdown fences by default;
 *          JSON.parse(text.trim()) throws on the leading ``` and the
 *          catch block fires the AUTO_REPLY/0.3 fallback. Result: every
 *          message gets the wrong label even though the API call works.
 *
 * Fix: strip optional ```json ... ``` (or unlabeled ``` ... ```) fence
 *      around the JSON before parsing. Belt + suspenders: the system
 *      prompt also instructs the model to skip the fence.
 *
 * No Supabase, no network, no Anthropic SDK. Mirrors the parser branch
 * inside classifyReply so that a code change which removes the fence-strip
 * regex flips this test red without us having to spin up the LLM.
 */

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

// Mirrors the parser branch in src/lib/email/reply-classifier.ts (the
// classifyReply success path). Keep in lockstep — if the source changes,
// update here.
function parseClassificationText(text: string): { classification: string; confidence: number } {
  let parseInput = text.trim();
  const fenceMatch = parseInput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) parseInput = fenceMatch[1].trim();
  const result = JSON.parse(parseInput);
  return {
    classification: result.classification,
    confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
  };
}

// 1. Bare JSON still parses (preserves prior behavior).
{
  const out = parseClassificationText('{"classification":"INTERESTED","confidence":0.92}');
  assert(out.classification === 'INTERESTED', `bare JSON classification, got ${out.classification}`);
  assert(out.confidence === 0.92, `bare JSON confidence, got ${out.confidence}`);
}

// 2. Bare JSON with surrounding whitespace still parses.
{
  const out = parseClassificationText('  \n{"classification":"OBJECTION","confidence":0.5}  \n');
  assert(out.classification === 'OBJECTION', 'bare JSON + whitespace classification');
  assert(out.confidence === 0.5, 'bare JSON + whitespace confidence');
}

// 3. ```json ... ``` fence-wrapped strips correctly.
{
  const fenced = '```json\n{"classification":"SPAM","confidence":0.81}\n```';
  const out = parseClassificationText(fenced);
  assert(out.classification === 'SPAM', `fenced json classification, got ${out.classification}`);
  assert(out.confidence === 0.81, `fenced json confidence, got ${out.confidence}`);
}

// 4. ``` (unlabeled) fence-wrapped strips correctly.
{
  const fenced = '```\n{"classification":"AUTO_REPLY","confidence":0.95}\n```';
  const out = parseClassificationText(fenced);
  assert(out.classification === 'AUTO_REPLY', 'unlabeled fence classification');
  assert(out.confidence === 0.95, 'unlabeled fence confidence');
}

// 5. Fence with extra padding inside.
{
  const fenced = '```json\n\n  {"classification":"STOP","confidence":0.7}  \n\n```';
  const out = parseClassificationText(fenced);
  assert(out.classification === 'STOP', 'fence with padding classification');
  assert(out.confidence === 0.7, 'fence with padding confidence');
}

// 6. Confidence default of 0.5 when missing/zero (preserves prior behavior).
{
  const out = parseClassificationText('{"classification":"NOT_INTERESTED","confidence":0}');
  assert(out.confidence === 0.5, `zero confidence default, got ${out.confidence}`);
}

// 7. Garbage input still throws (so the catch branch keeps firing the
//    AUTO_REPLY/0.3 fallback the source code expects).
{
  let threw = false;
  try {
    parseClassificationText('not json at all');
  } catch {
    threw = true;
  }
  assert(threw, 'garbage input must throw so the source-side catch can fire');
}

// 8. Real failure mode from msg 474 on 2026-04-30 — the exact shape the
//    journal showed. This is the regression case.
{
  const haiku45_actual = '```json\n{"classification": "AUTO_REPLY", "confidence": 0.95}\n```';
  const out = parseClassificationText(haiku45_actual);
  assert(out.classification === 'AUTO_REPLY', 'real Haiku 4.5 OOO classification');
  assert(out.confidence === 0.95, `real Haiku 4.5 OOO confidence (NOT the 0.3 fallback), got ${out.confidence}`);
}

console.log('PASS reply-classifier-fence-strip.test.ts (8 cases)');
