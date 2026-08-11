import pc from 'picocolors';
import type {
  KulalaResponseItem,
  KulalaResponseWrapper,
  RunFileResult,
} from '../kulala-core/types';
import { isResponseSuccessful, printHumanReadable } from './human';
import { formatRunHeader, itemDisplayName, parseAssertionTree } from './shared';

function wrapperItems(wrapper: KulalaResponseWrapper): KulalaResponseItem[] {
  return wrapper.type === 'error' ? wrapper.data : wrapper.data;
}

function hasAnyTests(item: KulalaResponseItem): boolean {
  if (!('scriptConsole' in item) || !item.scriptConsole?.length) {
    return false;
  }
  const tree = parseAssertionTree(item.scriptConsole);
  return tree.tests.length > 0 || tree.standaloneAsserts.length > 0;
}

function hasTestFailures(item: KulalaResponseItem): boolean {
  if (!('scriptConsole' in item) || !item.scriptConsole?.length) {
    return false;
  }
  const tree = parseAssertionTree(item.scriptConsole);
  if (tree.tests.some((t) => !t.pass)) {
    return true;
  }
  return tree.standaloneAsserts.some((a) => !a.pass);
}

function formatTestsOnly(item: KulalaResponseItem): string {
  if (!('scriptConsole' in item) || !item.scriptConsole?.length) {
    return '';
  }
  const tree = parseAssertionTree(item.scriptConsole);
  const lines: string[] = [];

  const GROUP_SYMBOL = '';
  const PASS_SYMBOL = '✓';
  const FAIL_SYMBOL = '✗';

  for (const test of tree.tests) {
    lines.push(
      test.pass
        ? pc.green(`${PASS_SYMBOL} ${GROUP_SYMBOL} ${test.name}`)
        : pc.red(`${FAIL_SYMBOL} ${GROUP_SYMBOL} ${test.name}`),
    );
    for (const assert of test.asserts) {
      lines.push(
        assert.pass
          ? pc.green(`  ${PASS_SYMBOL} ${assert.message}`)
          : pc.red(`  ${FAIL_SYMBOL} ${assert.message}`),
      );
    }
  }

  for (const assert of tree.standaloneAsserts) {
    lines.push(
      assert.pass
        ? pc.green(`${PASS_SYMBOL} ${assert.message}`)
        : pc.red(`${FAIL_SYMBOL} ${assert.message}`),
    );
  }

  return lines.join('\n').trim();
}

export async function printTests(
  results: RunFileResult[],
  options: { quiet: boolean },
): Promise<void> {
  const blocks: string[] = [];

  for (const result of results) {
    const items = wrapperItems(result.response);

    for (const item of items) {
      const requestFailed = !isResponseSuccessful(item);
      const testsFailed = hasTestFailures(item);
      const shouldPrint = options.quiet ? requestFailed || testsFailed : true;
      if (!shouldPrint) {
        continue;
      }

      // Failures: show normal human readable output, but always include file header.
      if (requestFailed || testsFailed) {
        await printHumanReadable([
          { filepath: result.filepath, response: { type: 'responses', data: [item] } },
        ]);
        continue;
      }

      // Passing requests: show only tests output (if any).
      if (!hasAnyTests(item)) {
        continue;
      }

      const testsText = formatTestsOnly(item);
      if (!testsText) {
        continue;
      }

      const header = formatRunHeader(result.filepath, itemDisplayName(item));
      blocks.push(`${header}\n${testsText}`);
    }
  }

  if (blocks.length > 0 && !options.quiet) {
    console.log(blocks.join('\n\n'));
  }
}
