export const Skeleton = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-control bg-stone-200 ${className}`} />
);
