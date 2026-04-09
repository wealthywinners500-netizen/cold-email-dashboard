import type { Metadata } from 'next';
import { SafeClerkProvider } from '@/components/safe-clerk-provider';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'StealthMail — Cold Email Infrastructure Dashboard',
  description:
    'Manage your cold email servers, campaigns, leads, and deliverability from one dashboard. Built for operators who scale.',
  openGraph: {
    title: 'StealthMail',
    description: 'Cold Email Infrastructure Management Dashboard',
    url: 'https://cold-email-dashboard.vercel.app',
    type: 'website',
  },
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SafeClerkProvider>
      <html lang="en">
        <body>
          {children}
          <Toaster position="bottom-right" theme="dark" richColors />
        </body>
      </html>
    </SafeClerkProvider>
  );
}
