export default function CampaignsLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 bg-gray-800 rounded w-1/4" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-800 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 bg-gray-800 rounded-lg" />
        <div className="h-80 bg-gray-800 rounded-lg" />
      </div>
      <div className="h-64 bg-gray-800 rounded-lg" />
    </div>
  );
}
