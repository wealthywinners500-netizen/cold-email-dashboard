export default function CampaignDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-4">
        <div className="h-8 bg-gray-800 rounded-lg w-1/3"></div>
        <div className="flex gap-3">
          <div className="h-6 bg-gray-800 rounded-full w-24"></div>
          <div className="h-6 bg-gray-800 rounded w-32"></div>
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-4 border-b border-gray-800">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-gray-800 rounded w-24"></div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-900 rounded-lg border border-gray-800 p-6 space-y-3">
            <div className="h-4 bg-gray-800 rounded w-20"></div>
            <div className="h-8 bg-gray-800 rounded w-16"></div>
          </div>
        ))}
      </div>

      {/* Card skeleton */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 space-y-4">
        <div className="h-6 bg-gray-800 rounded w-32"></div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-gray-800 rounded"></div>
          ))}
        </div>
      </div>
    </div>
  );
}
