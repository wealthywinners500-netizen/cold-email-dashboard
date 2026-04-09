import { ReactNode } from 'react';

interface ErrorWrapperProps {
  children: ReactNode;
  suppressErrors?: boolean;
}

/**
 * Wraps components that might fail during pre-rendering due to missing runtime configuration.
 * Used to suppress errors during builds with test Clerk keys.
 */
export function ErrorWrapper({ children }: ErrorWrapperProps) {
  try {
    return <>{children}</>;
  } catch (error) {
    // During build time, just return empty
    if (typeof window === 'undefined') {
      return null;
    }
    throw error;
  }
}
