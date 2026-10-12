export * from '@canvas-one/system-design/versioning/history-summary';

// ============================================================================
// Formatting helpers
// ============================================================================

export function formatCommitTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatPublicationDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  return `${day} ${month}`;
}
