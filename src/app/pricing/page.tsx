import Link from 'next/link';
import { Check } from 'lucide-react';

const pricingTiers = [
  {
    name: 'Starter',
    price: '$29',
    period: '/month',
    description: 'Perfect for testing cold email at scale',
    features: [
      'Up to 3 server pairs',
      'Basic dashboard',
      '1 user account',
      'Email support',
      '14-day free trial',
    ],
    cta: 'Get Started',
    ctaHref: '/sign-up',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$79',
    period: '/month',
    description: 'For serious cold email operators',
    features: [
      'Unlimited server pairs',
      'AI insights (coming soon)',
      'API access',
      'Up to 5 user accounts',
      'Priority support',
      '14-day free trial',
    ],
    cta: 'Get Started',
    ctaHref: '/sign-up',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: 'pricing',
    description: 'For teams scaling to massive volume',
    features: [
      'White-label solution',
      'Dedicated support team',
      'Unlimited users',
      'Custom integrations',
      'SLA guarantee',
      '14-day free trial',
    ],
    cta: 'Contact Sales',
    ctaHref: 'mailto:dean.hofer@thestealthmail.com',
    highlighted: false,
  },
];

export default function Pricing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/30">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="text-2xl font-bold text-primary">StealthMail</div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-foreground hover:text-primary transition-colors">
            Dashboard
          </Link>
          <Link href="/sign-in" className="text-foreground hover:text-primary transition-colors">
            Sign In
          </Link>
        </div>
      </nav>

      <section className="px-6 py-20">
        <h1 className="text-5xl font-bold text-center mb-6 text-foreground">Simple, Transparent Pricing</h1>
        <p className="text-xl text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          Scale your cold email operations from startup to enterprise. No hidden fees.
        </p>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {pricingTiers.map((tier) => (
            <div
              key={tier.name}
              className={`p-8 rounded-lg border transition-all ${
                tier.highlighted
                  ? 'border-primary bg-primary/5 scale-105'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
            >
              {tier.highlighted && (
                <div className="inline-block px-4 py-1 rounded-full bg-primary text-primary-foreground text-sm font-semibold mb-4">
                  Most Popular
                </div>
              )}
              <h2 className="text-2xl font-bold mb-2 text-foreground">{tier.name}</h2>
              <p className="text-muted-foreground mb-4">{tier.description}</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-primary">{tier.price}</span>
                {tier.period !== 'pricing' && <span className="text-muted-foreground ml-2">{tier.period}</span>}
              </div>
              <Link
                href={tier.ctaHref}
                className={`inline-block w-full text-center py-3 px-6 rounded-lg font-semibold mb-6 transition-colors ${
                  tier.highlighted
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border text-foreground hover:bg-secondary'
                }`}
              >
                {tier.cta}
              </Link>
              <ul className="space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Check className="w-5 h-5 text-primary flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-20 max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold mb-6 text-foreground">Questions?</h2>
        <p className="text-muted-foreground mb-8">
          Contact our team for custom pricing or enterprise solutions.
        </p>
        <Link
          href="mailto:dean.hofer@thestealthmail.com"
          className="inline-block px-8 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
        >
          Contact Sales
        </Link>
      </section>
    </div>
  );
}
