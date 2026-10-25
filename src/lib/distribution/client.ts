// Browser-side nudge: a slot may have opened (lead closed, reopened,
// transferred, unassigned), so ask the server to distribute queued leads
// and rebalance. Fire-and-forget — the cron is the safety net.
export function requestDistribution(): void {
  void fetch('/api/distribution/run', { method: 'POST' }).catch(() => {});
}
