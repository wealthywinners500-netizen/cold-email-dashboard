export default function Loading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="h-8 w-48 bg-gray-800 rounded animate-pulse" />
        <div className="h-4 w-72 bg-gray-800 rounded animate-pulse mt-2" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="h-4 w-24 bg-gray-800 rounded animate-pulse mb-2" />
            <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
