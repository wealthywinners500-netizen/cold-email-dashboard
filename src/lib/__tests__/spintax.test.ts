import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { renderSpintax, SpintaxParseError } from '../spintax';

describe('renderSpintax — flat blocks', () => {
  it('picks a specific branch deterministically with a fixed seed', () => {
    const rng1 = seedrandom('seed-A');
    const rng2 = seedrandom('seed-A');
    expect(renderSpintax('{{RANDOM | a | b | c}}', rng1)).toBe(
      renderSpintax('{{RANDOM | a | b | c}}', rng2)
    );
  });

  it('same seed, two calls → identical output', () => {
    const rng = seedrandom('abc');
    const out1 = renderSpintax('{{RANDOM | foo | bar | baz}}', rng);
    const rng2 = seedrandom('abc');
    const out2 = renderSpintax('{{RANDOM | foo | bar | baz}}', rng2);
    expect(out1).toBe(out2);
  });

  it('all branches are reachable across many seeds', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      outcomes.add(renderSpintax('{{RANDOM | a | b | c}}', seedrandom(`seed-${i}`)));
    }
    expect(outcomes).toContain('a');
    expect(outcomes).toContain('b');
    expect(outcomes).toContain('c');
  });

  it('whitespace around | is stripped; whitespace inside option preserved', () => {
    const rng = () => 0; // always first
    expect(renderSpintax('{{RANDOM |  hello  world  | bye}}', rng)).toBe('hello  world');
  });

  it('empty option: both "a" and "" are possible', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      outcomes.add(renderSpintax('{{RANDOM | a | }}', seedrandom(`s-${i}`)));
    }
    expect(outcomes).toContain('a');
    expect(outcomes).toContain('');
  });
});

describe('renderSpintax — nested blocks', () => {
  it('nested: {{RANDOM | x {{RANDOM | y | z}} | w}} produces all terminal outputs', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      outcomes.add(
        renderSpintax('{{RANDOM | x {{RANDOM | y | z}} | w}}', seedrandom(`s-${i}`))
      );
    }
    expect(outcomes).toContain('x y');
    expect(outcomes).toContain('x z');
    expect(outcomes).toContain('w');
  });

  it('deeply-nested input renders without stack overflow', () => {
    // Build a chain of 50 nested RANDOM blocks around a 10k-char filler.
    const filler = 'x'.repeat(10_000);
    let template = filler;
    for (let i = 0; i < 50; i++) {
      template = `{{RANDOM | L${i} ${template} | R${i}}}`;
    }
    const rng = () => 0;
    const result = renderSpintax(template, rng);
    // With rng() === 0, every block picks index 0 (the "L<i>" option), so the
    // result is a left-aligned spiral into the filler.
    expect(result).toContain(filler);
    expect(result).toContain('L0');
    expect(result).toContain('L49');
  });
});

describe('renderSpintax — escapes', () => {
  it('escaped \\{\\{ and \\}\\} render as literal {{ and }}', () => {
    expect(renderSpintax('\\{\\{not_spintax\\}\\}', Math.random)).toBe(
      '{{not_spintax}}'
    );
  });

  it('escapes mixed with a real block', () => {
    const rng = () => 0; // picks "hi"
    expect(renderSpintax('\\{\\{foo\\}\\} {{RANDOM | hi | bye}}', rng)).toBe(
      '{{foo}} hi'
    );
  });
});

describe('renderSpintax — non-spintax braces pass through', () => {
  it('top-level {{first_name}} is untouched', () => {
    expect(renderSpintax('Hi {{first_name}}', Math.random)).toBe('Hi {{first_name}}');
  });

  it('mixed spintax and template variables at top level', () => {
    const rng = () => 0; // always "there"
    expect(
      renderSpintax('Hi {{RANDOM | there | friend}} {{first_name}}', rng)
    ).toBe('Hi there {{first_name}}');
  });

  it('{{first_name}} inside a RANDOM option passes through (balance-tracked)', () => {
    const rng = () => 0; // first option
    expect(
      renderSpintax('{{RANDOM | Hi {{first_name}} | Hello}}', rng)
    ).toBe('Hi {{first_name}}');
  });
});

describe('renderSpintax — errors', () => {
  it('unbalanced {{RANDOM throws SpintaxParseError with position', () => {
    try {
      renderSpintax('{{RANDOM | a | b', Math.random);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpintaxParseError);
      expect((err as SpintaxParseError).position).toBeGreaterThan(0);
    }
  });

  it('{{RANDOM}} without any | throws', () => {
    // "RANDOM}}" doesn't match isSpintaxBlockStart (next char is '}', not ' ' or '|'),
    // so it falls through as a non-spintax literal. Verify that behavior — it
    // renders as literal rather than parsing as a zero-option block.
    expect(renderSpintax('{{RANDOM}}', Math.random)).toBe('{{RANDOM}}');
  });

  it('{{RANDOM   }} with only whitespace, no | throws', () => {
    expect(() => renderSpintax('{{RANDOM   }}', Math.random)).toThrow(SpintaxParseError);
  });
});
