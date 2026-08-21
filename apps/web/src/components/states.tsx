export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 rounded-md bg-neutral-800/70" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-700 p-6 text-center">
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: { kind: string; message: string };
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-md border border-red-900/60 bg-red-950/40 p-4">
      <p className="text-sm font-medium text-red-300">Could not load data ({error.kind} error)</p>
      <p className="mt-1 text-xs text-red-400/80">{error.message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-red-700 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-900/50"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
