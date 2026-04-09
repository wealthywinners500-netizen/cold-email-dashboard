'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { ReactNode } from 'react';

export function ClerkProviderWrapper({ children }: { children: ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
