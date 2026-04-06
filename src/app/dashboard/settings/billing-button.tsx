'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function BillingButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (searchParams.get('billing') === 'success') {
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
        // Remove query param
        router.replace('/dashboard/settings');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, router]);

  const handleManageBilling = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to access billing portal');
      }

      const { url } = await response.json();
      router.push(url);
    } catch (error) {
      console.error('Billing portal error:', error);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showSuccess && (
        <div className="mb-4 p-4 bg-green-900/20 border border-green-600/50 rounded-lg text-green-400">
          Subscription updated successfully!
        </div>
      )}
      <button
        onClick={handleManageBilling}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Loading...' : 'Manage Billing'}
      </button>
    </>
  );
}
