import pc from 'picocolors';
import type { KulalaWebSocketTranscriptEntry } from '../kulala-core/types';

const livePrinted = new WeakSet<object>();

export function markWebSocketLivePrinted(item: object): void {
  livePrinted.add(item);
}

export function wasWebSocketLivePrinted(item: object): boolean {
  return livePrinted.has(item);
}

export function formatWebSocketTranscriptLine(
  event: KulalaWebSocketTranscriptEntry,
): string | undefined {
  if (event.type === 'sent') return `--> ${event.data ?? ''}`;
  if (event.type === 'message') return `<-- ${event.data ?? ''}`;
  if (event.type === 'waiting') {
    const remaining = event.remaining ?? 0;
    const noun = remaining === 1 ? 'message' : 'messages';
    return pc.dim(`Waiting for ${remaining} server ${noun}…`);
  }
  if (event.type === 'script-done') return pc.dim('Script finished.');
  if (event.type === 'error') return pc.red(event.error ?? 'WebSocket error');
  return undefined;
}
