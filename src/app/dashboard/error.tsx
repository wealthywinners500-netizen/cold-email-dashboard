"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mb-4">
        <span className="text-3xl">!</span>
      </div>
      <h2 className="text-2xl font-bold text-white mb-4">
        Something went wrong
      </h2>
      <p className="text-gray-400 mb-6 max-w-md">{error.message}</p>
      <button
        onClick={reset}
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
