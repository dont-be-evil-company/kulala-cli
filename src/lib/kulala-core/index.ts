import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloader } from '../downloader';
import { isPromptResponse } from '../output/shared';
import type { KulalaEnvironmentCatalog, KulalaResponseWrapper, RunOptions } from './types';

export type { KulalaResponseWrapper, RunFileResult, RunOptions } from './types';

export type HttpStreamEvent = {
  type: 'http-stream';
  event: 'headers' | 'chunk' | 'error';
  status?: number;
  httpVersion?: string;
  headers?: Record<string, string>;
  url?: string;
  data?: string;
  error?: string;
  blockName?: string;
};

export function parseHttpStreamLine(line: string): HttpStreamEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    const value = JSON.parse(trimmed) as HttpStreamEvent;
    if (value && value.type === 'http-stream' && typeof value.event === 'string') {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type InvokeOptions = {
  cwd?: string;
  onHttpStream?: (event: HttpStreamEvent) => void;
};

type InvokeResult = {
  stdout: string;
  stderr: string;
  status: number | null;
};

let cachedExecutable: string | null = null;

async function executablePath(): Promise<string> {
  if (!cachedExecutable) {
    cachedExecutable = await downloader.ensureInstalled();
  }
  if (!cachedExecutable) {
    throw new Error('kulala-core executable not resolved');
  }
  return cachedExecutable;
}

function invokeRaw(
  payload: Record<string, unknown>,
  options: InvokeOptions = {},
): Promise<InvokeResult> {
  const exe = cachedExecutable;
  if (!exe) {
    return Promise.reject(new Error('kulala-core executable not resolved'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let pending = '';

    const takeLine = (line: string): void => {
      const event = parseHttpStreamLine(line);
      if (event) {
        options.onHttpStream?.(event);
        return;
      }
      stdout += `${line}\n`;
    };

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        takeLine(line);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (status) => {
      if (pending) {
        const event = parseHttpStreamLine(pending);
        if (event) {
          options.onHttpStream?.(event);
        } else {
          stdout += pending;
        }
      }
      resolve({ stdout, stderr, status });
    });

    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
  });
}

export function tryDecodeWrapper(stdout: string): KulalaResponseWrapper | undefined {
  const raw = stdout.trim();
  if (!raw) {
    return undefined;
  }

  try {
    const wrapper = JSON.parse(raw) as KulalaResponseWrapper;
    if (wrapper && typeof wrapper === 'object' && wrapper.type) {
      return wrapper;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parseInvokeResponse(job: InvokeResult): KulalaResponseWrapper {
  const wrapper = tryDecodeWrapper(job.stdout);
  const first = wrapper?.type === 'responses' ? wrapper.data[0] : undefined;
  const isPrompt = Boolean(first && isPromptResponse(first));

  if (job.status !== 0 && !isPrompt) {
    throw new Error(
      job.stderr?.trim() || `kulala-core exited with code ${job.status ?? 'unknown'}`,
    );
  }

  if (!wrapper) {
    throw new Error(job.stderr?.trim() || 'kulala-core returned empty or invalid output');
  }

  return wrapper;
}

export type WebSocketSessionEvent = {
  type: string;
  data?: string;
  error?: string;
  remaining?: number;
  code?: number;
};

export type WebSocketSessionHandle = {
  close(): void;
  kill(): void;
  readonly exited: Promise<number | null>;
};

export async function startWebSocketSession(
  connect: Record<string, unknown>,
  onEvent: (event: WebSocketSessionEvent) => void,
  cwd?: string,
): Promise<WebSocketSessionHandle> {
  const exe = await executablePath();
  const tmp = path.join(
    os.tmpdir(),
    `kulala-ws-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(tmp, JSON.stringify(connect), 'utf8');

  const child = spawn(exe, ['--websocket', '-i', tmp], {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as WebSocketSessionEvent);
      } catch {
        /* ignore malformed lines */
      }
    }
  });
  child.stdin.on('error', () => {
    /* Ignore EPIPE when the child exits early. */
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      resolve(code);
    });
  });

  return {
    exited,
    close() {
      if (child.stdin.destroyed || !child.stdin.writable) return;
      try {
        child.stdin.write(`${JSON.stringify({ op: 'close' })}\n`);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EPIPE') throw err;
      }
    },
    kill() {
      child.kill('SIGTERM');
    },
  };
}

export async function runHttp(
  options: RunOptions,
  invokeOptions: InvokeOptions = {},
): Promise<KulalaResponseWrapper> {
  await executablePath();

  const job = await invokeRaw(
    {
      action: 'run',
      content: options.content,
      filepath: options.filepath,
      env: options.env,
      limit: options.limit,
      haltOnError: options.haltOnError,
    },
    invokeOptions,
  );

  return parseInvokeResponse(job);
}

export async function continueHttp(
  options: { promptId: string; inputs: Array<{ id: string; value: string }> },
  invokeOptions: InvokeOptions = {},
): Promise<KulalaResponseWrapper> {
  await executablePath();

  const job = await invokeRaw(
    {
      action: 'continue',
      promptId: options.promptId,
      inputs: options.inputs,
    },
    invokeOptions,
  );

  return parseInvokeResponse(job);
}

export async function environments(
  options: { cwd?: string; filepath?: string } = {},
  invokeOptions: InvokeOptions = {},
): Promise<KulalaEnvironmentCatalog> {
  await executablePath();

  const job = await invokeRaw(
    {
      action: 'environments',
      cwd: options.cwd,
      filepath: options.filepath,
    },
    invokeOptions,
  );

  if (job.status !== 0) {
    throw new Error(
      job.stderr?.trim() || `kulala-core exited with code ${job.status ?? 'unknown'}`,
    );
  }

  const raw = job.stdout.trim();
  if (!raw) {
    throw new Error('kulala-core returned empty output');
  }

  return JSON.parse(raw) as KulalaEnvironmentCatalog;
}

export async function curl(
  options: { argv: string[] },
  invokeOptions: InvokeOptions = {},
): Promise<KulalaResponseWrapper> {
  await executablePath();

  const job = await invokeRaw(
    {
      action: 'curl',
      argv: options.argv,
    },
    invokeOptions,
  );

  return parseInvokeResponse(job);
}

export async function convertImage(
  options: { content: string; mediaType?: string; target: 'png' },
  invokeOptions: InvokeOptions = {},
): Promise<{
  content: string;
  mediaType: string;
  byteLength: number;
  convertedFrom?: 'jpeg';
} | null> {
  await executablePath();

  const job = await invokeRaw(
    {
      action: 'convert_image',
      content: options.content,
      mediaType: options.mediaType,
      target: options.target,
    },
    invokeOptions,
  );

  if (job.status !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(job.stdout.trim()) as {
      type?: string;
      success?: boolean;
      content?: string;
      mediaType?: string;
      byteLength?: number;
      convertedFrom?: 'jpeg';
    };
    if (
      parsed.type !== 'convert_image' ||
      parsed.success !== true ||
      typeof parsed.content !== 'string' ||
      typeof parsed.mediaType !== 'string' ||
      typeof parsed.byteLength !== 'number'
    ) {
      return null;
    }
    return {
      content: parsed.content,
      mediaType: parsed.mediaType,
      byteLength: parsed.byteLength,
      ...(parsed.convertedFrom ? { convertedFrom: parsed.convertedFrom } : {}),
    };
  } catch {
    return null;
  }
}

export const kulalaCore = {
  runHttp,
  continueHttp,
  environments,
  curl,
  convertImage,
  startWebSocketSession,
};
