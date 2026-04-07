export default function ProvisioningLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div>
        <div className="h-8 w-48 bg-gray-800 rounded animate-pulse" />
        <div className="h-4 w-96 bg-gray-800/60 rounded animate-pulse mt-3" />
      </div>

      {/* Cards skeleton */}
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-5 w-40 bg-gray-800 rounded animate-pulse" />
                <div className="h-3 w-24 bg-gray-800/60 rounded animate-pulse" />
              </div>
              <div className="h-6 w-20 bg-gray-800 rounded-full animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <div className="h-3 w-32 bg-gray-800/60 rounded animate-pulse" />
                <div className="h-3 w-8 bg-gray-800/60 rounded animate-pulse" />
              </div>
              <div className="h-2 w-full bg-gray-800 rounded-full animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="border-b border-gray-800 px-4 py-3 flex gap-4">
          {[120, 80, 70, 100].map((w, i) => (
            <div key={i} className={`h-4 bg-gray-800 rounded animate-pulse`} style={{ width: w }} />
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="border-b border-gray-800/50 px-4 py-3 flex gap-4">
            {[140, 60, 80, 110].map((w, j) => (
              <div key={j} className={`h-4 bg-gray-800/60 rounded animate-pulse`} style={{ width: w }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
