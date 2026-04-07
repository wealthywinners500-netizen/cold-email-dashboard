export default function AdminLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-48 bg-gray-800 rounded animate-pulse" />
          <div className="h-4 w-72 bg-gray-800 rounded animate-pulse mt-2" />
        </div>
        <div className="h-6 w-16 bg-gray-800 rounded animate-pulse" />
      </div>
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-48 bg-gray-800 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}
