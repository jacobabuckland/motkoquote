export default function RunViewerLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 text-lg font-medium">Loading run viewer...</div>
        <div className="text-sm text-muted-foreground">
          Fetching pipeline execution data
        </div>
      </div>
    </div>
  );
}
