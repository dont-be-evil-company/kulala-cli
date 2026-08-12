import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { fileWalker } from '../filewalker';
import { kulalaCore } from '../kulala-core';
import type {
  KulalaResponseItem,
  KulalaResponseWrapper,
  RunFileResult,
} from '../kulala-core/types';
import {
  countResults,
  filterFailedResults,
  printHumanReadable,
  printJson,
  printReport,
  printTests,
} from '../output';
import { setColorEnabled } from '../output/highlight';
import { findFirstPromptItem, isPromptResponse } from '../output/shared';
import { collectPromptInputs } from '../prompt';
import { isInteractiveTerminal, withSpinner } from '../spinner';
import { buildRunLimit, resolveSingleHttpFile } from './limit';
import type { RunLimit } from '../kulala-core/types';
import { presentResponseItems } from '../websocket/execute';

const MAX_PROMPT_DEPTH = 7;

const HTTP_EXTENSIONS = ['.http', '.rest'];

export type RunCommandOptions = {
  json?: boolean;
  report?: boolean;
  tests?: boolean;
  quiet?: boolean;
  halt?: boolean;
  shuffle?: boolean;
  env?: string;
  name?: string;
  line?: number;
  column?: number;
  color?: boolean;
};

type OutputContext = {
  json?: boolean;
  tests?: boolean;
  quiet?: boolean;
};

function shuffleFiles<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function resolveFiles(inputPath: string, shuffle: boolean): string[] {
  let files = fileWalker(inputPath, HTTP_EXTENSIONS);
  if (files.length === 0) {
    console.error(chalk.red(`No .http or .rest files found at: ${inputPath}`));
    process.exit(1);
  }

  files.sort();
  if (shuffle) {
    files = shuffleFiles(files);
  }

  return files;
}

function responseHasFailure(result: RunFileResult): boolean {
  return countResults(result.response).failed > 0;
}

function shouldStreamOutput(ctx: OutputContext): boolean {
  return !ctx.json && !ctx.tests;
}

async function streamResponseItems(
  filepath: string,
  items: KulalaResponseItem[],
  ctx: OutputContext,
  halt: boolean,
  streamedBlocks?: Set<string>,
): Promise<void> {
  await presentResponseItems(filepath, items, {
    print: shouldStreamOutput(ctx),
    quiet: ctx.quiet ?? false,
    halt,
    streamedBlocks,
  });
}

function continueSucceeded(response: KulalaResponseWrapper): boolean {
  const first = response.type === 'responses' ? response.data[0] : undefined;
  return first?.success === true;
}

function mergeRunResponses(
  accumulated: KulalaResponseItem[],
  response: KulalaResponseWrapper,
): KulalaResponseWrapper {
  if (response.type === 'error' || accumulated.length === 0) {
    return response;
  }
  return { type: 'responses', data: [...accumulated, ...response.data] };
}

function completedItemsBeforePrompt(response: KulalaResponseWrapper): KulalaResponseItem[] {
  if (response.type !== 'responses') {
    return [];
  }
  const promptIndex = response.data.findIndex((item) => isPromptResponse(item));
  if (promptIndex <= 0) {
    return [];
  }
  return response.data.slice(0, promptIndex);
}

function newItemsSinceAccumulated(
  accumulated: KulalaResponseItem[],
  response: KulalaResponseWrapper,
): KulalaResponseItem[] {
  if (response.type !== 'responses') {
    return [];
  }
  return response.data.slice(accumulated.length);
}

function promptBlockName(promptItem: KulalaResponseItem): string | undefined {
  if ('blockName' in promptItem && typeof promptItem.blockName === 'string') {
    const name = promptItem.blockName.trim();
    return name || undefined;
  }
  return undefined;
}

async function runFileWithPromptRetry(
  relativePath: string,
  env: string | undefined,
  limit: RunLimit[] | undefined,
  halt: boolean,
  output: OutputContext,
  depth = 0,
  accumulated: KulalaResponseItem[] = [],
): Promise<RunFileResult> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const cwd = path.dirname(absolutePath);
  const runOptions = {
    content,
    filepath: absolutePath,
    env,
    limit,
    haltOnError: halt,
  };

  const streamedBlocks = new Set<string>();
  const liveBody = shouldStreamOutput(output) && !output.quiet;
  const keepAlive = content.includes('@kulala-keep-alive-stream');
  const execute = () =>
    kulalaCore.runHttp(runOptions, {
      cwd,
      onHttpStream: liveBody
        ? (event) => {
            if (event.event === 'headers') {
              streamedBlocks.add(event.blockName?.trim() || '');
              const status = event.status ?? '';
              process.stdout.write(`HTTP ${status}${event.url ? ` ${event.url}` : ''}\n`);
              return;
            }
            if (event.event === 'chunk' && event.data) {
              process.stdout.write(event.data);
              return;
            }
            if (event.event === 'error' && event.error) {
              process.stderr.write(`${event.error}\n`);
            }
          }
        : undefined,
    });
  const response =
    keepAlive || !isInteractiveTerminal()
      ? await execute()
      : await withSpinner(`Running requests in file ${relativePath}`, execute);
  const promptItem = response.type === 'responses' ? findFirstPromptItem(response) : undefined;

  if (!promptItem) {
    const final = mergeRunResponses(accumulated, response);
    if (liveBody && streamedBlocks.size > 0) {
      process.stdout.write('\n');
    }
    await streamResponseItems(
      relativePath,
      newItemsSinceAccumulated(accumulated, final),
      output,
      halt,
      streamedBlocks,
    );
    return {
      filepath: relativePath,
      response: final,
      outputStreamed: shouldStreamOutput(output),
    };
  }

  if (depth >= MAX_PROMPT_DEPTH) {
    console.error(chalk.red('Kulala: exceeded prompt / retry limit.'));
    const final = mergeRunResponses(accumulated, response);
    await streamResponseItems(
      relativePath,
      newItemsSinceAccumulated(accumulated, final),
      output,
      halt,
      streamedBlocks,
    );
    return {
      filepath: relativePath,
      response: final,
      outputStreamed: shouldStreamOutput(output),
    };
  }

  const completedBefore = completedItemsBeforePrompt(response);
  const newAccumulated = [...accumulated, ...completedBefore];
  if (liveBody && streamedBlocks.size > 0) {
    process.stdout.write('\n');
  }
  await streamResponseItems(relativePath, completedBefore, output, halt, streamedBlocks);

  const inputs = await collectPromptInputs(promptItem);
  if (!inputs || !promptItem.promptId) {
    console.error(chalk.yellow('Prompt cancelled or incomplete.'));
    return {
      filepath: relativePath,
      response: mergeRunResponses(newAccumulated, response),
      outputStreamed: shouldStreamOutput(output),
    };
  }

  const continued = isInteractiveTerminal()
    ? await withSpinner(`Running requests in file ${relativePath}`, () =>
        kulalaCore.continueHttp({ promptId: promptItem.promptId, inputs }, { cwd }),
      )
    : await kulalaCore.continueHttp({ promptId: promptItem.promptId, inputs }, { cwd });

  if (!continueSucceeded(continued)) {
    let err: string | undefined;
    if (continued.type === 'error') {
      err = continued.data[0]?.error;
    } else {
      const item = continued.data[0];
      err = item && 'error' in item ? item.error : undefined;
    }
    console.error(chalk.red(err ?? 'Prompt continuation failed.'));
    return { filepath: relativePath, response: continued };
  }

  const blockName = promptBlockName(promptItem);
  const retryLimit: RunLimit[] | undefined =
    completedBefore.length > 0 && blockName ? [{ filter: 'name', name: blockName }] : limit;

  return runFileWithPromptRetry(
    relativePath,
    env,
    retryLimit,
    halt,
    output,
    depth + 1,
    newAccumulated,
  );
}

async function runFile(
  relativePath: string,
  env: string | undefined,
  limit: RunLimit[] | undefined,
  halt: boolean,
  output: OutputContext,
): Promise<RunFileResult> {
  return runFileWithPromptRetry(relativePath, env, limit, halt, output);
}

function hasFailures(results: RunFileResult[]): boolean {
  return results.some((result) => responseHasFailure(result));
}

export async function run(inputPath: string, options: RunCommandOptions): Promise<void> {
  if (options.color === false) {
    setColorEnabled(false);
  }

  // Backwards compatibility: --report is replaced by --tests.
  if (options.report && !options.tests) {
    options.tests = true;
  }

  const output: OutputContext = {
    json: options.json,
    tests: options.tests,
    quiet: options.quiet,
  };

  const limit = buildRunLimit(options);
  const files = limit
    ? [resolveSingleHttpFile(inputPath)]
    : resolveFiles(inputPath, options.shuffle ?? false);
  const results: RunFileResult[] = [];

  const halt = options.halt ?? false;

  for (const file of files) {
    const result = await runFile(file, options.env, limit, halt, output);
    results.push(result);

    if (halt && responseHasFailure(result)) {
      break;
    }
  }

  const pendingOutput = results.filter((result) => !result.outputStreamed);
  const outputResults =
    options.quiet && !options.tests ? filterFailedResults(pendingOutput) : pendingOutput;

  if (options.tests) {
    // Tests mode handles its own "quiet" filtering because failures include test failures.
    await printTests(results, { quiet: options.quiet ?? false });
  } else if (!options.quiet || outputResults.length > 0) {
    if (options.json) {
      printJson(results);
    } else if (options.report) {
      printReport(pendingOutput);
    } else if (pendingOutput.length > 0) {
      await printHumanReadable(outputResults);
    }
  }

  if (hasFailures(results)) {
    process.exit(1);
  }
}
