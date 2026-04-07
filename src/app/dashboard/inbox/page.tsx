import { Suspense } from 'react';
import InboxClient from './inbox-client';
import InboxLoading from './loading';

export const dynamic = 'force-dynamic';

export default function InboxPage() {
  return (
    <Suspense fallback={<InboxLoading />}>
      <InboxClient />
    </Suspense>
  );
}
