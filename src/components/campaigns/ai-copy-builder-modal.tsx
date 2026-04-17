'use client';

/**
 * Phase 3 — AI Copy Builder modal.
 *
 * Controlled modal. Collects product / audience / tone / length / etc. →
 * POST /api/ai/generate-copy → renders 1-4 variant cards. Per-card actions:
 *   - "Use as subject+body" — calls onPick([single variant]) and closes
 *   - "Use all as A/B/C/D variants" — calls onPick(all variants) and closes
 *
 * Uses Radix Dialog (already a dep via @radix-ui/react-dialog) directly — no
 * shadcn dialog wrapper needed. Feature-flag-gated.
 *
 * NOT mounted in Phase 3. Phase 4 mounts it from the sequence step editor.
 */

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { isFeatureEnabledSync } from '@/lib/featureFlags';

type Tone = 'casual' | 'professional' | 'friendly' | 'direct';
type Length = 'short' | 'medium' | 'long';
type StepType = 'initial' | 'followup';

export interface GeneratedVariant {
  subject: string;
  body: string;
}

export interface AICopyBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (variants: GeneratedVariant[]) => void;
  availableVariables?: string[];
}

const DEFAULT_VARS = ['first_name', 'company_name'];

export function AICopyBuilderModal({
  open,
  onOpenChange,
  onPick,
  availableVariables = DEFAULT_VARS,
}: AICopyBuilderModalProps) {
  const [product, setProduct] = React.useState('');
  const [audience, setAudience] = React.useState('');
  const [problem, setProblem] = React.useState('');
  const [cta, setCta] = React.useState('15-min call');
  const [tone, setTone] = React.useState<Tone>('professional');
  const [length, setLength] = React.useState<Length>('medium');
  const [stepType, setStepType] = React.useState<StepType>('initial');
  const [variantsN, setVariantsN] = React.useState(2);
  const [includeSpintax, setIncludeSpintax] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [results, setResults] = React.useState<GeneratedVariant[] | null>(null);

  if (!isFeatureEnabledSync('campaigns_v2')) return null;

  async function onGenerate() {
    if (pending) return;
    if (!product.trim() || !audience.trim() || !problem.trim() || !cta.trim()) {
      toast.error('Fill every field before generating.');
      return;
    }
    setPending(true);
    setResults(null);
    try {
      const resp = await fetch('/api/ai/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: product.trim(),
          audience: audience.trim(),
          problem_solved: problem.trim(),
          cta: cta.trim(),
          tone,
          length,
          step_type: stepType,
          variants: variantsN,
          include_spintax: includeSpintax,
          personalization_variables: availableVariables,
        }),
      });
      if (resp.status === 429) {
        toast.error('Too many AI requests — wait a minute.');
        return;
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err?.error ?? 'AI generation failed');
        return;
      }
      const data = (await resp.json()) as { variants: GeneratedVariant[] };
      setResults(data.variants ?? []);
    } catch {
      toast.error('Network error — try again.');
    } finally {
      setPending(false);
    }
  }

  function onUseSingle(variant: GeneratedVariant) {
    onPick([variant]);
    onOpenChange(false);
  }
  function onUseAll() {
    if (results && results.length > 0) {
      onPick(results);
      onOpenChange(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-background p-6 shadow-lg max-h-[90vh]">
          <Dialog.Title className="text-lg font-semibold mb-1">AI Copy Builder</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mb-4">
            Generate cold email copy from a short brief. Results are suggestions — review before sending.
          </Dialog.Description>

          <div className="space-y-3">
            <label className="block text-sm">
              <span className="block mb-1 text-muted-foreground">Product / service</span>
              <input className="w-full rounded border px-3 py-2 text-sm" value={product} onChange={(e) => setProduct(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="block mb-1 text-muted-foreground">Target audience</span>
              <input className="w-full rounded border px-3 py-2 text-sm" value={audience} onChange={(e) => setAudience(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="block mb-1 text-muted-foreground">Problem it solves</span>
              <input className="w-full rounded border px-3 py-2 text-sm" value={problem} onChange={(e) => setProblem(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="block mb-1 text-muted-foreground">Call to action</span>
              <input className="w-full rounded border px-3 py-2 text-sm" value={cta} onChange={(e) => setCta(e.target.value)} />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="block mb-1 text-muted-foreground">Tone</span>
                <select className="w-full rounded border px-3 py-2 text-sm" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                  <option value="casual">casual</option>
                  <option value="professional">professional</option>
                  <option value="friendly">friendly</option>
                  <option value="direct">direct</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="block mb-1 text-muted-foreground">Length</span>
                <select className="w-full rounded border px-3 py-2 text-sm" value={length} onChange={(e) => setLength(e.target.value as Length)}>
                  <option value="short">short</option>
                  <option value="medium">medium</option>
                  <option value="long">long</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="block mb-1 text-muted-foreground">Step type</span>
                <select className="w-full rounded border px-3 py-2 text-sm" value={stepType} onChange={(e) => setStepType(e.target.value as StepType)}>
                  <option value="initial">initial</option>
                  <option value="followup">follow-up</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="block mb-1 text-muted-foreground">Variants to produce</span>
                <select className="w-full rounded border px-3 py-2 text-sm" value={variantsN} onChange={(e) => setVariantsN(Number(e.target.value))}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm mt-5">
                <input type="checkbox" checked={includeSpintax} onChange={(e) => setIncludeSpintax(e.target.checked)} />
                <span>Include spintax</span>
              </label>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={onGenerate} disabled={pending}>
              {pending ? 'Generating…' : 'Generate'}
            </Button>
          </div>

          {results && results.length > 0 && (
            <div className="mt-6 border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {results.length === 1 ? '1 variant' : `${results.length} variants`}
                </div>
                {results.length > 1 && (
                  <Button variant="secondary" size="sm" onClick={onUseAll}>
                    Use all as A/B/C/D
                  </Button>
                )}
              </div>
              {results.map((v, i) => (
                <div key={i} className="rounded border p-3 text-sm">
                  <div className="mb-1 text-muted-foreground">Subject</div>
                  <div className="mb-2 font-medium">{v.subject || <em>(empty)</em>}</div>
                  <div className="mb-1 text-muted-foreground">Body</div>
                  <pre className="mb-3 whitespace-pre-wrap font-sans">{v.body}</pre>
                  <Button variant="outline" size="sm" onClick={() => onUseSingle(v)}>
                    Use as subject+body
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AICopyBuilderModal;
