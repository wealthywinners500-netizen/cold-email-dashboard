'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreateOrganization } from '@clerk/nextjs';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Server,
  Mail,
  Users,
  Rocket,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';

interface OnboardingWizardProps {
  hasOrg: boolean;
}

type Step = 'welcome' | 'organization' | 'server' | 'complete';

export default function OnboardingWizard({ hasOrg }: OnboardingWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>(hasOrg ? 'welcome' : 'welcome');
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSuccess, setServerSuccess] = useState(false);

  // Server form state
  const [nsDomain, setNsDomain] = useState('');
  const [s1Ip, setS1Ip] = useState('');
  const [s1Hostname, setS1Hostname] = useState('');
  const [s2Ip, setS2Ip] = useState('');
  const [s2Hostname, setS2Hostname] = useState('');

  const handleProceedFromWelcome = () => {
    if (hasOrg) {
      setCurrentStep('server');
    } else {
      setCurrentStep('organization');
    }
  };

  const handleProceedFromOrg = () => {
    setCurrentStep('server');
  };

  const handleSubmitServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setServerError(null);

    try {
      const response = await fetch('/api/server-pairs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ns_domain: nsDomain,
          s1_ip: s1Ip,
          s1_hostname: s1Hostname,
          s2_ip: s2Ip,
          s2_hostname: s2Hostname,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create server pair');
      }

      setServerSuccess(true);
      toast.success("Your first server pair has been added!");
      // Refresh server data
      router.refresh();
      // Move to completion step
      setTimeout(() => {
        setCurrentStep('complete');
      }, 1000);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackFromOrg = () => {
    setCurrentStep('welcome');
  };

  const handleBackFromServer = () => {
    if (hasOrg) {
      setCurrentStep('welcome');
    } else {
      setCurrentStep('organization');
    }
  };

  const handleGoToDashboard = () => {
    window.location.href = '/dashboard';
  };

  // Step 1: Welcome
  if (currentStep === 'welcome') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-gray-900 border-gray-800">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-blue-600 rounded-full p-4">
                <Rocket className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl">Welcome to StealthMail!</CardTitle>
            <CardDescription className="text-gray-400 mt-2">
              Let's set up your cold email infrastructure
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3 text-sm text-gray-400">
              <div className="flex items-start gap-3">
                <Server className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span>Deploy dedicated mail servers with full control</span>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span>Manage sending domains and campaign automation</span>
              </div>
              <div className="flex items-start gap-3">
                <Users className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span>Organize leads and track follow-ups seamlessly</span>
              </div>
            </div>

            <Button
              onClick={handleProceedFromWelcome}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Create Organization
  if (currentStep === 'organization') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-gray-900 border-gray-800">
          <CardHeader className="text-center">
            <CardTitle>Create Your Organization</CardTitle>
            <CardDescription className="text-gray-400 mt-2">
              Set up your team workspace to get started
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <CreateOrganization afterCreateOrganizationUrl="/dashboard" />
            </div>

            <Button
              variant="ghost"
              onClick={handleBackFromOrg}
              className="w-full text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 3: Add Your First Server Pair
  if (currentStep === 'server') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-gray-900 border-gray-800">
          <CardHeader className="text-center">
            <CardTitle>Add Your First Server Pair</CardTitle>
            <CardDescription className="text-gray-400 mt-2">
              Enter your nameserver domain and server details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {serverSuccess && (
              <div className="flex items-center justify-center space-x-2 text-green-500">
                <CheckCircle className="w-5 h-5" />
                <span>Server pair created successfully!</span>
              </div>
            )}

            {serverError && (
              <div className="bg-red-900/20 border border-red-800 rounded p-3 text-red-400 text-sm">
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmitServer} className="space-y-4">
              {/* NS Domain */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">
                  Nameserver Domain
                </label>
                <input
                  type="text"
                  placeholder="ns.example.com"
                  value={nsDomain}
                  onChange={(e) => setNsDomain(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-blue-600 focus:outline-none disabled:opacity-50"
                />
              </div>

              {/* Server 1 */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase">
                  Server 1
                </label>
                <input
                  type="text"
                  placeholder="IP Address (e.g., 192.168.1.1)"
                  value={s1Ip}
                  onChange={(e) => setS1Ip(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-blue-600 focus:outline-none disabled:opacity-50"
                />
                <input
                  type="text"
                  placeholder="Hostname (e.g., mail1.example.com)"
                  value={s1Hostname}
                  onChange={(e) => setS1Hostname(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-blue-600 focus:outline-none disabled:opacity-50"
                />
              </div>

              {/* Server 2 */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase">
                  Server 2
                </label>
                <input
                  type="text"
                  placeholder="IP Address (e.g., 192.168.1.2)"
                  value={s2Ip}
                  onChange={(e) => setS2Ip(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-blue-600 focus:outline-none disabled:opacity-50"
                />
                <input
                  type="text"
                  placeholder="Hostname (e.g., mail2.example.com)"
                  value={s2Hostname}
                  onChange={(e) => setS2Hostname(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-blue-600 focus:outline-none disabled:opacity-50"
                />
              </div>

              {/* Submit */}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {isLoading ? 'Creating...' : 'Create Server Pair'}
                {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </form>

            <Button
              variant="ghost"
              onClick={handleBackFromServer}
              disabled={isLoading}
              className="w-full text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 4: You're Ready!
  if (currentStep === 'complete') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-gray-900 border-gray-800">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-green-600 rounded-full p-4">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl">You're Ready!</CardTitle>
            <CardDescription className="text-gray-400 mt-2">
              Your dashboard is all set up
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-gray-400 text-center">
              Start adding campaigns, importing leads, or configuring more servers
              to scale your cold email operations.
            </p>

            <Button
              onClick={handleGoToDashboard}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
