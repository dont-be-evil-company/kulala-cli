import { spawn } from 'node:child_process';
import { downloader } from '../downloader';
import { isPromptResponse } from '../output/shared';
import type { KulalaEnvironmentCatalog, KulalaResponseWrapper, RunOptions } from './types';

export type { KulalaResponseWrapper, RunFileResult, RunOptions } from './types';

export type InvokeOptions = {
  cwd?: string;
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

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (status) => {
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
};
