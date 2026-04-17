/**
 * Instantly-compatible spintax renderer.
 *
 * Grammar:
 *   {{RANDOM | A | B | C}}     → pick one of A/B/C uniformly
 *   nested:  {{RANDOM | Hi {{RANDOM | there | friend}} | Hello}}
 *   escape:  \{\{  →  literal "{{"
 *            \}\}  →  literal "}}"
 *   non-spintax {{foo}} pass through untouched (e.g. {{first_name}})
 *
 * Whitespace around "|" is stripped; whitespace inside options preserved.
 * Empty option ("{{RANDOM | a | }}") renders "".
 *
 * Unbalanced / malformed spintax throws SpintaxParseError with a `position`
 * field pointing at the offset in the input where parsing failed.
 *
 * To use deterministic output (pg-boss retries), pass a seeded RNG:
 *   renderSpintax(text, seedrandom(`${recipientId}:${stepIndex}`))
 */

export class SpintaxParseError extends Error {
  public readonly position: number;
  constructor(message: string, position: number) {
    super(`${message} at position ${position}`);
    this.name = 'SpintaxParseError';
    this.position = position;
  }
}

interface Ctx {
  input: string;
  pos: number;
  rng: () => number;
}

const RANDOM_TOKEN = 'RANDOM';

function isSpintaxBlockStart(ctx: Ctx): boolean {
  // ctx.pos is at '{{'. Peek for "RANDOM" followed by whitespace or '|'.
  const after = ctx.input.substring(ctx.pos + 2);
  if (!after.startsWith(RANDOM_TOKEN)) return false;
  const next = after[RANDOM_TOKEN.length];
  return next === '|' || next === ' ' || next === '\t';
}

/**
 * Parse a run of text until one of:
 *   - end of input (when !insideBlock)
 *   - '|' or '}}' AT THIS BLOCK'S DEPTH  (when insideBlock — returns WITHOUT consuming)
 *
 * Non-RANDOM double-brace tokens like `{{first_name}}` are passed through as
 * literal text AND balance-tracked so that a `}}` inside `{{first_name}}` does
 * NOT terminate the enclosing RANDOM option. Depth resets per parseText call
 * (each option has its own local depth tracker).
 *
 * Inside a spintax block, unterminated input (EOF before '}}') is an error.
 */
function parseText(ctx: Ctx, insideBlock: boolean): string {
  let out = '';
  let nonRandomDepth = 0; // open non-RANDOM `{{...}}` tokens awaiting their `}}`

  while (ctx.pos < ctx.input.length) {
    // Escape sequences: \{\{  and  \}\}
    if (ctx.input.substring(ctx.pos, ctx.pos + 4) === '\\{\\{') {
      out += '{{';
      ctx.pos += 4;
      continue;
    }
    if (ctx.input.substring(ctx.pos, ctx.pos + 4) === '\\}\\}') {
      out += '}}';
      ctx.pos += 4;
      continue;
    }

    const c2 = ctx.input.substring(ctx.pos, ctx.pos + 2);

    if (c2 === '{{') {
      if (isSpintaxBlockStart(ctx)) {
        out += parseRandomBlock(ctx);
        continue;
      }
      // Non-RANDOM double-brace — pass through literally and bump depth so
      // the matching `}}` is also passed through instead of terminating.
      out += '{{';
      ctx.pos += 2;
      nonRandomDepth++;
      continue;
    }

    if (c2 === '}}') {
      if (nonRandomDepth > 0) {
        out += '}}';
        ctx.pos += 2;
        nonRandomDepth--;
        continue;
      }
      if (insideBlock) {
        // End of current option — return WITHOUT consuming.
        return out;
      }
      // Top-level literal `}}` — emit and continue.
      out += '}}';
      ctx.pos += 2;
      continue;
    }

    if (insideBlock && nonRandomDepth === 0 && ctx.input[ctx.pos] === '|') {
      return out;
    }

    out += ctx.input[ctx.pos];
    ctx.pos++;
  }

  if (insideBlock) {
    throw new SpintaxParseError(
      'unterminated {{RANDOM ...}} block (reached end of input)',
      ctx.pos
    );
  }
  return out;
}

function skipInlineWhitespace(ctx: Ctx): void {
  while (
    ctx.pos < ctx.input.length &&
    (ctx.input[ctx.pos] === ' ' || ctx.input[ctx.pos] === '\t')
  ) {
    ctx.pos++;
  }
}

/**
 * Parse a RANDOM block. Precondition: ctx.pos is at '{{' and isSpintaxBlockStart()
 * returned true. Consumes the block through the closing '}}' and returns the
 * chosen option's rendered text.
 */
function parseRandomBlock(ctx: Ctx): string {
  const blockStart = ctx.pos;
  ctx.pos += 2 + RANDOM_TOKEN.length; // past "{{RANDOM"
  skipInlineWhitespace(ctx);

  if (ctx.input[ctx.pos] !== '|') {
    throw new SpintaxParseError(
      'expected "|" after RANDOM',
      ctx.pos
    );
  }

  const options: string[] = [];
  while (ctx.input[ctx.pos] === '|') {
    ctx.pos++; // consume '|'
    skipInlineWhitespace(ctx);
    const rendered = parseText(ctx, true);
    // Trim trailing inline whitespace (spec: whitespace AROUND "|" stripped).
    options.push(rendered.replace(/[ \t]+$/, ''));
  }

  if (ctx.input.substring(ctx.pos, ctx.pos + 2) !== '}}') {
    throw new SpintaxParseError(
      'expected "}}" to close RANDOM block',
      ctx.pos
    );
  }
  ctx.pos += 2;

  if (options.length === 0) {
    // Shouldn't happen — we verified at least one '|' above. Defensive.
    throw new SpintaxParseError(
      'RANDOM block has zero options',
      blockStart
    );
  }

  const idx = Math.floor(ctx.rng() * options.length);
  return options[Math.min(idx, options.length - 1)];
}

/**
 * Render all spintax blocks in `template` using the provided RNG.
 *
 * Non-spintax double-brace tokens (e.g. `{{first_name}}`) pass through
 * untouched so the caller's template engine can resolve them afterward.
 *
 * @throws {SpintaxParseError} on malformed input.
 */
export function renderSpintax(
  template: string,
  rng: () => number = Math.random
): string {
  const ctx: Ctx = { input: template, pos: 0, rng };
  const rendered = parseText(ctx, false);
  if (ctx.pos !== template.length) {
    throw new SpintaxParseError(
      'unexpected trailing input',
      ctx.pos
    );
  }
  return rendered;
}
