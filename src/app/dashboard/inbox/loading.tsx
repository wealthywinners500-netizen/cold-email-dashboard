export default function InboxLoading() {
  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="h-8 w-32 bg-gray-800 rounded animate-pulse mb-4" />
      <div className="flex flex-1 rounded-lg border border-gray-800 overflow-hidden">
        {/* Left panel skeleton */}
        <div className="w-2/5 border-r border-gray-800 bg-gray-900">
          <div className="p-4 border-b border-gray-800">
            <div className="h-8 bg-gray-800 rounded animate-pulse" />
          </div>
          <div className="p-2 space-y-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="p-3 flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-800 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-800 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-gray-800 rounded animate-pulse w-full" />
                  <div className="h-3 bg-gray-800 rounded animate-pulse w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel skeleton */}
        <div className="flex-1 bg-gray-950 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-full animate-pulse mx-auto mb-4" />
            <div className="h-4 w-48 bg-gray-800 rounded animate-pulse mx-auto" />
          </div>
        </div>
      </div>
    </div>
  );
}
