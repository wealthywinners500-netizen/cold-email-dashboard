export default function FollowUpsLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 bg-gray-800 rounded w-1/4" />
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-800 rounded-lg" />
        ))}
      </div>
      <div className="h-96 bg-gray-800 rounded-lg" />
    </div>
  );
}
