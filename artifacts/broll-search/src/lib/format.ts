export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatElapsed(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}m ${s}s`;
}

export function formatProgressLabel(
  step: string,
  current?: number | null,
  total?: number | null,
  bytesDownloaded?: number | null,
  bytesTotal?: number | null,
): string {
  if (bytesDownloaded != null) {
    const dl = formatBytes(bytesDownloaded);
    if (bytesTotal != null && bytesTotal > 0) {
      return `${step} — ${dl} / ${formatBytes(bytesTotal)}`;
    }
    return `${step} — ${dl}`;
  }
  if (current != null && total != null) {
    return `${step} (${current}/${total})`;
  }
  return step;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}
