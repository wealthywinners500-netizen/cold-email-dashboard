import Link from 'next/link';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/30">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Link href="/" className="text-2xl font-bold text-primary hover:text-primary/80 transition-colors">
          StealthMail
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-foreground hover:text-primary transition-colors">
            Pricing
          </Link>
          <Link href="/sign-in" className="text-foreground hover:text-primary transition-colors">
            Sign In
          </Link>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-5xl font-bold text-foreground mb-4">Privacy Policy</h1>
        <p className="text-muted-foreground mb-12">Last updated: April 6, 2026</p>

        <div className="space-y-8 text-foreground">
          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">1. What Data We Collect</h2>
            <p className="text-muted-foreground mb-3">
              StealthMail collects the following information:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li><strong>Account information:</strong> Email address, name, organization name, and password</li>
              <li><strong>Organization data:</strong> Server configurations, domain names, email account settings, campaign information, and recipient lists</li>
              <li><strong>Server configurations:</strong> Hostnames, IP addresses, SMTP relay settings, DKIM/SPF/DMARC records, and PTR records</li>
              <li><strong>Campaign data:</strong> Email templates, send logs, delivery status, opens, clicks, and replies</li>
              <li><strong>Usage data:</strong> Login timestamps, feature usage, and dashboard activity</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">2. How We Use Your Data</h2>
            <p className="text-muted-foreground mb-3">
              We use your data solely to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Provide and maintain the StealthMail service</li>
              <li>Configure and monitor your email servers and accounts</li>
              <li>Deliver campaign analytics and reporting</li>
              <li>Monitor domain health and blacklist status</li>
              <li>Provide technical support</li>
              <li>Verify compliance with our Acceptable Use Policy</li>
              <li>Improve service performance and security</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              We do not sell, share, or rent your personal data to third parties for marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">3. Third-Party Services</h2>
            <p className="text-muted-foreground mb-3">
              StealthMail integrates with the following third-party services:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li><strong>Clerk:</strong> Authentication and account management. Clerk processes your email and password for secure login.</li>
              <li><strong>Stripe:</strong> Payment processing for subscription billing. Stripe processes your payment method information.</li>
              <li><strong>Supabase:</strong> Database and storage for your configurations, campaign data, and analytics.</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              Each of these services has its own privacy policy. We recommend reviewing their policies at their respective websites.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">4. Data Retention</h2>
            <p className="text-muted-foreground">
              We retain your data for as long as your account is active. If you close your account, we will retain your data for 30 days to allow for account recovery. After that period, your data will be deleted, except where we are required to retain it by law or for legitimate business purposes (such as dispute resolution).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">5. Your Rights</h2>
            <p className="text-muted-foreground mb-3">
              Consistent with GDPR and similar privacy laws, you have the right to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li><strong>Access:</strong> Request a copy of all personal data we hold about you</li>
              <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data</li>
              <li><strong>Deletion:</strong> Request deletion of your personal data (subject to legal retention requirements)</li>
              <li><strong>Portability:</strong> Request your data in a portable format</li>
              <li><strong>Opt-out:</strong> Withdraw consent for data processing at any time</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              To exercise any of these rights, contact us at dean.hofer@thestealthmail.com.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">6. Security</h2>
            <p className="text-muted-foreground">
              We implement industry-standard security measures to protect your data from unauthorized access, alteration, and disclosure. However, no method of transmission over the internet is 100% secure. Please use strong passwords and protect your account credentials.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">7. Changes to This Privacy Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time. We will notify you of material changes by updating the "Last updated" date. Your continued use of the service constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">8. Contact</h2>
            <p className="text-muted-foreground">
              For questions about this Privacy Policy or to exercise your data rights, please contact us at{' '}
              <Link href="mailto:dean.hofer@thestealthmail.com" className="text-primary hover:underline">
                dean.hofer@thestealthmail.com
              </Link>
            </p>
          </section>
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-border text-center text-muted-foreground mt-16">
        <div className="max-w-4xl mx-auto mb-4">
          <div className="flex justify-center gap-6 mb-4">
            <Link href="/" className="hover:text-primary transition-colors">
              Home
            </Link>
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-primary transition-colors">
              Privacy
            </Link>
          </div>
        </div>
        <p>© 2026 StealthMail. All rights reserved.</p>
      </footer>
    </div>
  );
}
