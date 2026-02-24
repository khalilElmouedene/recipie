interface Props {
  current: number | null;
  total: number | null;
}

export function ProgressBar({ current, total }: Props) {
  const pct =
    current !== null && total !== null && total > 0
      ? Math.min(100, Math.round((current / total) * 100))
      : 0;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
        <span>Progress</span>
        <span>
          {current ?? 0} / {total ?? "?"} rows ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
