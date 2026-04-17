'use client';

/**
 * Phase 3 — "Add random spintax" button.
 *
 * Click → POST /api/ai/add-spintax with current editor text → replaces
 * content via onChange. Feature-flag-gated: renders null when
 * campaigns_v2 flag is off.
 *
 * NOT mounted anywhere in Phase 3. Phase 4 wires it into
 * sequence-step-editor.tsx and the main campaigns tab.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { isFeatureEnabledSync } from '@/lib/featureFlags';

export interface AddRandomSpintaxButtonProps {
  value: string;
  onChange: (next: string) => void;
  intensity?: 'minimal' | 'moderate';
  className?: string;
}

export function AddRandomSpintaxButton({
  value,
  onChange,
  intensity = 'minimal',
  className,
}: AddRandomSpintaxButtonProps) {
  const [pending, setPending] = React.useState(false);

  if (!isFeatureEnabledSync('campaigns_v2')) return null;

  async function onClick() {
    if (pending) return;
    if (!value.trim()) {
      toast.error('Write some copy first, then add spintax.');
      return;
    }
    setPending(true);
    try {
      const resp = await fetch('/api/ai/add-spintax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value, intensity }),
      });
      if (resp.status === 429) {
        toast.error('AI is busy — try again in a minute.');
        return;
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err?.error ?? 'Failed to add spintax');
        return;
      }
      const data = (await resp.json()) as { text: string };
      onChange(data.text);
      toast.success('Spintax added.');
    } catch {
      toast.error('Network error — try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onClick}
      className={className}
    >
      {pending ? 'Adding spintax…' : 'Add random spintax'}
    </Button>
  );
}

export default AddRandomSpintaxButton;
