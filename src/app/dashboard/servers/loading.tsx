export default function ServersLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 bg-gray-800 rounded w-1/4" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-800 rounded-lg" />
        ))}
      </div>
      <div className="h-96 bg-gray-800 rounded-lg" />
    </div>
  );
}
