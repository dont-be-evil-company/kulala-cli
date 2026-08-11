import { kulalaCore } from '../kulala-core';
import { isInteractiveTerminal, withSpinner } from '../spinner';
import { countResults, printHumanReadable, printJson } from '../output';
import { setColorEnabled } from '../output/highlight';
import type { RunFileResult } from '../kulala-core/types';

export type CurlCommandOptions = {
  json?: boolean;
  color?: boolean;
};

const KULALA_CURL_FLAGS = new Set(['--json', '--no-color']);

export function parseCurlArgv(argv: string[]): {
  curlArgv: string[];
  options: CurlCommandOptions;
} {
  const curlArgv: string[] = [];
  const options: CurlCommandOptions = {};

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--no-color') {
      options.color = false;
      continue;
    }
    if (KULALA_CURL_FLAGS.has(arg)) {
      continue;
    }
    curlArgv.push(arg);
  }

  return { curlArgv, options };
}

function formatCurlLabel(curlArgv: string[]): string {
  if (curlArgv.length === 0) {
    return 'curl';
  }
  return `curl ${curlArgv.join(' ')}`;
}

export async function curl(argv: string[], options: CurlCommandOptions = {}): Promise<void> {
  if (options.color === false) {
    setColorEnabled(false);
  }

  const { curlArgv, options: parsedOptions } = parseCurlArgv(argv);
  const mergedOptions = { ...parsedOptions, ...options };

  if (curlArgv.length === 0) {
    console.error('Usage: kulala curl [options] <curl arguments...>');
    console.error('');
    console.error('Examples:');
    console.error('  kulala curl -I https://example.com');
    console.error('  kulala curl -H "Accept: application/json" https://echo.kulala.app/get');
    process.exit(1);
  }

  const response = isInteractiveTerminal()
    ? await withSpinner('Running request', () => kulalaCore.curl({ argv: curlArgv }))
    : await kulalaCore.curl({ argv: curlArgv });
  const result: RunFileResult = {
    filepath: formatCurlLabel(curlArgv),
    response,
  };

  if (mergedOptions.json) {
    printJson([result]);
  } else {
    await printHumanReadable([result]);
  }

  if (countResults(response).failed > 0) {
    process.exit(1);
  }
}
