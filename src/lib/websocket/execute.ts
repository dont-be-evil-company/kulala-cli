import { kulalaCore } from '../kulala-core';
import type {
  KulalaResponseItem,
  KulalaWebSocketMessage,
  KulalaWebSocketPlanResponse,
  KulalaWebSocketTranscriptEntry,
} from '../kulala-core/types';
import { isResponseSuccessful, printResponseItems } from '../output/human';
import { formatRunHeader, isWebSocketResponse } from '../output/shared';
import {
  formatWebSocketTranscriptLine,
  markWebSocketLivePrinted,
} from '../output/websocket';
import pc from 'picocolors';

/**
 * kulala-cli has no separate HTTP timeout setting.
 * `# @timeout` on the request wins; otherwise scripted waits use this cap
 * so `kulala run` cannot hang on `=== wait-for-server`.
 */
export const CLI_WEBSOCKET_SCRIPT_TIMEOUT_MS = 30_000;

function scriptMessages(item: KulalaWebSocketPlanResponse): KulalaWebSocketMessage[] {
  if (Array.isArray(item.messages)) return item.messages;
  if (item.initialMessage) return [{ waitForServer: 0, data: item.initialMessage }];
  return [];
}

function toTranscript(event: {
  type: string;
  data?: string;
  error?: string;
  remaining?: number;
  code?: number;
}): KulalaWebSocketTranscriptEntry | undefined {
  if (
    event.type !== 'ready' &&
    event.type !== 'message' &&
    event.type !== 'sent' &&
    event.type !== 'waiting' &&
    event.type !== 'script-done' &&
    event.type !== 'error' &&
    event.type !== 'closed'
  ) {
    return undefined;
  }
  return {
    type: event.type,
    data: event.data,
    error: event.error,
    remaining: event.remaining,
    code: event.code,
  };
}

async function runWebSocketPlan(
  item: KulalaWebSocketPlanResponse,
  options: { live: boolean; filepath?: string },
): Promise<{ ok: boolean; error?: string; transcript: KulalaWebSocketTranscriptEntry[] }> {
  const timeoutMs = item.timeoutMs ?? CLI_WEBSOCKET_SCRIPT_TIMEOUT_MS;
  const transcript: KulalaWebSocketTranscriptEntry[] = [];

  if (options.live) {
    const header = options.filepath
      ? `${formatRunHeader(options.filepath, item.url)}\n`
      : '';
    process.stdout.write(`${header}${pc.cyan(`WebSocket: ${item.url}`)}\n`);
    markWebSocketLivePrinted(item);
  }

  let settled = false;
  let ok = false;
  let error: string | undefined;

  let session: Awaited<ReturnType<typeof kulalaCore.startWebSocketSession>> | undefined;
  session = await kulalaCore.startWebSocketSession(
    {
      url: item.url,
      headers: item.request?.headers,
      messages: scriptMessages(item),
      timeoutMs,
    },
    (event) => {
      const entry = toTranscript(event);
      if (!entry) return;
      transcript.push(entry);
      if (options.live) {
        const line = formatWebSocketTranscriptLine(entry);
        if (line) process.stdout.write(`${line}\n`);
      }
      if (settled) return;
      if (event.type === 'script-done') {
        settled = true;
        ok = true;
        session?.close();
      } else if (event.type === 'error') {
        settled = true;
        ok = false;
        error = event.error ?? 'WebSocket error';
        session?.close();
      } else if (event.type === 'closed') {
        settled = true;
        ok = false;
        error = 'WebSocket closed before the script finished';
      }
    },
  );

  const backstop = setTimeout(() => {
    if (settled) return;
    settled = true;
    ok = false;
    error = 'Timed out waiting for WebSocket';
    session?.kill();
  }, timeoutMs + 10_000);

  try {
    await Promise.race([
      session.exited,
      new Promise<void>((resolve) => {
        const poll = () => {
          if (settled) {
            resolve();
            return;
          }
          setTimeout(poll, 20);
        };
        poll();
      }),
    ]);
    if (!settled) {
      settled = true;
      ok = false;
      error = 'WebSocket session ended before the script finished';
    }
    await Promise.race([
      session.exited,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          session?.kill();
          resolve();
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(backstop);
  }

  if (options.live) process.stdout.write('\n');
  return { ok, error, transcript };
}

export async function presentResponseItems(
  filepath: string,
  items: KulalaResponseItem[],
  options: {
    print: boolean;
    quiet: boolean;
    halt: boolean;
    streamedBlocks?: Set<string>;
  },
): Promise<void> {
  let haltFurther = false;
  const printable: KulalaResponseItem[] = [];
  const live = options.print && !options.quiet;

  const flush = async () => {
    if (!options.print || printable.length === 0) return;
    const batch = printable.splice(0, printable.length);
    await printResponseItems(filepath, batch, options.streamedBlocks);
  };

  for (const item of items) {
    if (!isWebSocketResponse(item)) {
      if (options.print && (!options.quiet || !isResponseSuccessful(item))) {
        printable.push(item);
      }
      continue;
    }

    if (haltFurther) {
      item.success = false;
      item.error = 'Skipped because a previous WebSocket script failed';
    } else if (item.transcript === undefined) {
      if (live) await flush();
      const outcome = await runWebSocketPlan(item, { live, filepath });
      item.transcript = outcome.transcript;
      if (!outcome.ok) {
        item.success = false;
        item.error = outcome.error ?? 'WebSocket script failed';
        if (options.halt) haltFurther = true;
      }
      if (live) continue;
    }

    if (options.print && (!options.quiet || !isResponseSuccessful(item))) {
      printable.push(item);
    }
  }

  await flush();
}
