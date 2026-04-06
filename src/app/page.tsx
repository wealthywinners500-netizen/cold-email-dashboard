import Link from 'next/link';
import { Server, Users, BarChart3, Rocket, CheckCircle, Shield, Zap, ArrowRight, Mail } from 'lucide-react';

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
          <Link
            href="/sign-up"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="px-6 py-24 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-block mb-4 px-3 py-1 bg-primary/10 rounded-full text-sm font-semibold text-primary">
            <Rocket className="inline w-4 h-4 mr-2" />
            Scale Your Cold Email Operations
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-foreground mb-6">
            The Command Center for Cold Email at Scale
          </h1>
          <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto leading-relaxed">
            Deploy and manage 20+ mail server pairs, warm up accounts at scale, track campaign
            analytics in real-time, and execute lead generation pipelines with precision—all from one unified dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/sign-up"
              className="px-8 py-4 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2"
            >
              Start Free Trial
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/pricing"
              className="px-8 py-4 border border-border rounded-lg font-semibold hover:bg-secondary transition-colors"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <h2 className="text-4xl font-bold text-center mb-4 text-foreground">
          How It Works
        </h2>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          Get your cold email operation running in three simple steps
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          {/* Step 1 */}
          <div className="relative">
            <div className="p-8 border border-border rounded-lg bg-card">
              <div className="w-14 h-14 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
                <Server className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold mb-4 text-foreground">
                Step 1: Connect Your Servers
              </h3>
              <p className="text-muted-foreground">
                Deploy and monitor HestiaCP server pairs on Clouding.io. Configure DNS records, DKIM, SPF, and DMARC with automatic PTR alignment for maximum deliverability.
              </p>
            </div>
            <div className="hidden md:block absolute -right-4 top-1/2 transform -translate-y-1/2">
              <ArrowRight className="w-8 h-8 text-border" />
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative">
            <div className="p-8 border border-border rounded-lg bg-card">
              <div className="w-14 h-14 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold mb-4 text-foreground">
                Step 2: Import & Verify Leads
              </h3>
              <p className="text-muted-foreground">
                Scrape prospects with Outscraper, verify emails with Reoon, and organize data with automated cleaning rules. Build targeted lists in seconds.
              </p>
            </div>
            <div className="hidden md:block absolute -right-4 top-1/2 transform -translate-y-1/2">
              <ArrowRight className="w-8 h-8 text-border" />
            </div>
          </div>

          {/* Step 3 */}
          <div>
            <div className="p-8 border border-border rounded-lg bg-card">
              <div className="w-14 h-14 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
                <Mail className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold mb-4 text-foreground">
                Step 3: Launch & Track Campaigns
              </h3>
              <p className="text-muted-foreground">
                Send campaigns across 300+ accounts, track delivery and engagement, monitor domain health, and optimize performance with real-time analytics.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof Section */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <Shield className="w-12 h-12 text-primary mx-auto mb-6" />
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Trusted by Cold Email Operators
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Managing 300+ accounts and scaling cold email operations globally
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              <span>99.9% Uptime SLA</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              <span>Zero Blacklist Errors</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              <span>24/7 Support</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
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

      {/* Pricing Section */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <h2 className="text-4xl font-bold text-center mb-4 text-foreground">
          Simple, Transparent Pricing
        </h2>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          Choose the plan that fits your cold email operation
        </p>
        <div className="grid md:grid-cols-3 gap-8 mb-12">
          {/* Starter Plan */}
          <div className="p-8 border border-border rounded-lg bg-card">
            <h3 className="text-2xl font-bold text-foreground mb-2">Starter</h3>
            <p className="text-muted-foreground mb-6">For new cold email operators</p>
            <div className="text-4xl font-bold text-primary mb-2">$29<span className="text-lg text-muted-foreground">/mo</span></div>
            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Up to 2 server pairs</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>50 email accounts</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Basic analytics</span>
              </div>
            </div>
            <Link
              href="/sign-up"
              className="w-full px-4 py-3 border border-border rounded-lg font-semibold hover:bg-secondary transition-colors text-center block"
            >
              Get Started
            </Link>
          </div>

          {/* Pro Plan */}
          <div className="p-8 border-2 border-primary rounded-lg bg-card ring-1 ring-primary/10 transform md:scale-105">
            <div className="inline-block mb-4 px-3 py-1 bg-primary/10 rounded-full text-sm font-semibold text-primary">
              Most Popular
            </div>
            <h3 className="text-2xl font-bold text-foreground mb-2">Pro</h3>
            <p className="text-muted-foreground mb-6">For scaling operations</p>
            <div className="text-4xl font-bold text-primary mb-2">$79<span className="text-lg text-muted-foreground">/mo</span></div>
            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Up to 10 server pairs</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>300 email accounts</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Advanced analytics</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Priority support</span>
              </div>
            </div>
            <Link
              href="/sign-up"
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors text-center block"
            >
              Start Free Trial
            </Link>
          </div>

          {/* Enterprise Plan */}
          <div className="p-8 border border-border rounded-lg bg-card">
            <h3 className="text-2xl font-bold text-foreground mb-2">Enterprise</h3>
            <p className="text-muted-foreground mb-6">For high-volume operations</p>
            <div className="text-4xl font-bold text-primary mb-2">Custom</div>
            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Unlimited server pairs</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Unlimited accounts</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Custom integrations</span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span>Dedicated support</span>
              </div>
            </div>
            <button
              className="w-full px-4 py-3 border border-border rounded-lg font-semibold hover:bg-secondary transition-colors cursor-not-allowed opacity-50"
              disabled
            >
              Contact Sales
            </button>
          </div>
        </div>

        <div className="text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors font-semibold"
          >
            View Full Pricing
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-20 max-w-4xl mx-auto text-center">
        <h2 className="text-4xl font-bold text-foreground mb-6">
          Ready to scale your cold email?
        </h2>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Join cold email operators managing 300+ accounts with StealthMail. Start your free trial today.
        </p>
        <Link
          href="/sign-up"
          className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
        >
          <Zap className="w-5 h-5" />
          Start Free Trial
        </Link>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div>
              <div className="text-xl font-bold text-primary mb-4">StealthMail</div>
              <p className="text-muted-foreground text-sm">
                The command center for cold email at scale.
              </p>
            </div>
            <div>
              <h4 className="text-foreground font-semibold mb-4">Product</h4>
              <div className="space-y-2">
                <Link href="/pricing" className="text-muted-foreground hover:text-foreground text-sm transition-colors block">
                  Pricing
                </Link>
                <Link href="/features" className="text-muted-foreground hover:text-foreground text-sm transition-colors block">
                  Features
                </Link>
              </div>
            </div>
            <div>
              <h4 className="text-foreground font-semibold mb-4">Legal</h4>
              <div className="space-y-2">
                <Link href="/terms" className="text-muted-foreground hover:text-foreground text-sm transition-colors block">
                  Terms of Service
                </Link>
                <Link href="/privacy" className="text-muted-foreground hover:text-foreground text-sm transition-colors block">
                  Privacy Policy
                </Link>
              </div>
            </div>
            <div>
              <h4 className="text-foreground font-semibold mb-4">Support</h4>
              <Link href="mailto:support@stealthmail.com" className="text-muted-foreground hover:text-foreground text-sm transition-colors block">
                support@stealthmail.com
              </Link>
            </div>
          </div>
          <div className="border-t border-border pt-8 text-center text-muted-foreground text-sm">
            <p>© 2026 StealthMail. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
