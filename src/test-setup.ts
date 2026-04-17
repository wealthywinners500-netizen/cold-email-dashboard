// Vitest global setup — extends expect with jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, etc.) and auto-cleans between tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's auto-cleanup hook doesn't fire reliably under vitest v4 + rolldown;
// call cleanup explicitly so DOM from one test can't leak into the next.
afterEach(() => {
  cleanup();
});
