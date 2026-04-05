import Link from 'next/link';
import { Server, BarChart3, Users } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/30">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="text-2xl font-bold text-primary">StealthMail</div>
        <div className="flex items-center gap-4">
          <Link
            href="/sign-in"
            className="text-foreground hover:text-primary transition-colors"
          >
            Sign In
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="px-6 py-20 text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6 max-w-4xl mx-auto">
          Cold Email Infrastructure, Managed.
        </h1>
        <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto">
          Deploy and manage 20+ mail server pairs, warm up accounts at scale, track campaign
          analytics in real-time, and execute lead generation pipelines with precision.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/dashboard"
            className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/pricing"
            className="px-8 py-3 border border-border rounded-lg font-semibold hover:bg-secondary transition-colors"
          >
            Pricing
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <h2 className="text-4xl font-bold text-center mb-16 text-foreground">
          Comprehensive Email Operations
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 border border-border rounded-lg bg-card">
            <Server className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-2 text-foreground">Server Management</h3>
            <p className="text-muted-foreground">
              Deploy HestiaCP mail servers on Clouding.io. Configure DNS, DKIM, SPF, and DMARC
              records. Manage server pairs with automatic hostname and PTR alignment.
            </p>
          </div>
          <div className="p-6 border border-border rounded-lg bg-card">
            <Users className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-2 text-foreground">Account Management</h3>
            <p className="text-muted-foreground">
              Manage 300+ Snov.io accounts. Configure SendGrid relay, warm up schedules, and
              campaign imports with CSV templates.
            </p>
          </div>
          <div className="p-6 border border-border rounded-lg bg-card">
            <BarChart3 className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-2 text-foreground">Campaign Analytics</h3>
            <p className="text-muted-foreground">
              Track email delivery, opens, clicks, and replies. Monitor blacklist status and
              domain health with real-time MXToolbox integration.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-border text-center text-muted-foreground">
        <p>© 2024 StealthMail. All rights reserved.</p>
      </footer>
    </div>
  );
}
