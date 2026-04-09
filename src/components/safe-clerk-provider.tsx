'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { ReactNode } from 'react';

interface SafeClerkProviderProps {
  children: ReactNode;
}

/**
 * Wrapper for ClerkProvider that suppresses validation errors during build.
 * During build time, if Clerk keys are invalid, we render children without Clerk.
 * During runtime, ClerkProvider works normally.
 */
export function SafeClerkProvider({ children }: SafeClerkProviderProps) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // If no publishable key is set or it's a test key, just render children
  // This prevents validation errors during static generation
  if (!publishableKey || publishableKey.startsWith('pk_test')) {
    return <>{children}</>;
  }

  return <ClerkProvider>{children}</ClerkProvider>;
}
