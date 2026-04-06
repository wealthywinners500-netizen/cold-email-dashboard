import Link from 'next/link';

export default function Terms() {
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
        <h1 className="text-5xl font-bold text-foreground mb-4">Terms of Service</h1>
        <p className="text-muted-foreground mb-12">Last updated: April 6, 2026</p>

        <div className="space-y-8 text-foreground">
          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">1. Service Description</h2>
            <p className="text-muted-foreground">
              StealthMail is a cold email infrastructure management dashboard that enables users to deploy, configure, and monitor email server pairs, manage email accounts, warm up accounts at scale, and execute lead generation campaigns. The platform provides tools for server management via HestiaCP, account management through Snov.io integration, campaign analytics, and domain health monitoring.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">2. User Responsibilities</h2>
            <p className="text-muted-foreground mb-3">
              By using StealthMail, you agree to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Comply with all applicable laws and regulations regarding email marketing and data privacy</li>
              <li>Obtain proper consent from all recipients before sending emails</li>
              <li>Maintain accurate and complete information in your account</li>
              <li>Protect your account credentials and notify us immediately of any unauthorized access</li>
              <li>Use the service only for legitimate business purposes</li>
              <li>Monitor your account activity and resolve any delivery or compliance issues</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">3. Acceptable Use Policy</h2>
            <p className="text-muted-foreground mb-3">
              You may not use StealthMail to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Send unsolicited bulk emails or spam</li>
              <li>Impersonate individuals or organizations</li>
              <li>Send emails to purchased lists without proper consent</li>
              <li>Circumvent email filters or authentication systems</li>
              <li>Send phishing, malware, or fraudulent content</li>
              <li>Violate the intellectual property rights of third parties</li>
              <li>Interfere with platform infrastructure or other users' access</li>
              <li>Use the service for any illegal purpose</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">4. Payment Terms</h2>
            <p className="text-muted-foreground mb-3">
              Payment is processed through Stripe. By subscribing to a paid plan, you authorize us to charge your payment method on a recurring monthly basis. Pricing is as shown on the Pricing page and may be subject to applicable taxes. All charges are non-refundable except where required by law. We reserve the right to update pricing with 30 days' notice.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">5. Limitation of Liability</h2>
            <p className="text-muted-foreground">
              StealthMail is provided "as is" without warranties of any kind. To the maximum extent permitted by law, we are not liable for indirect, incidental, special, or consequential damages, including lost profits or data loss, arising from your use of the service. Our total liability is limited to the fees you paid in the 30 days preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">6. Termination</h2>
            <p className="text-muted-foreground mb-3">
              We may terminate your account immediately if you:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Violate these Terms of Service</li>
              <li>Engage in illegal activity</li>
              <li>Breach our Acceptable Use Policy</li>
              <li>Cause harm to our infrastructure or other users</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              You may cancel your account at any time through your account settings. Upon termination, your access will be immediately revoked.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">7. Changes to Terms</h2>
            <p className="text-muted-foreground">
              We reserve the right to modify these Terms of Service at any time. Continued use of the service after changes constitutes your acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-foreground">8. Contact</h2>
            <p className="text-muted-foreground">
              For questions about these Terms of Service, please contact us at{' '}
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
