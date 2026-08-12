import type { KulalaResponseItem, RunFileResult } from '../kulala-core/types';
import { isResponseSuccessful } from './human';
import {
  escapeCell,
  formatMs,
  formatScriptOrigin,
  isErrorResponse,
  isPromptResponse,
  isSkippedResponse,
  isSuccessResponse,
  isWebSocketResponse,
  itemTitle,
  mdTable,
  parseAssertionTree,
  responseBodyLanguage,
  responseBodyText,
  splitScriptConsole,
  type ParsedAssert,
  type ParsedTestGroup,
} from './shared';

type ReportStats = {
  total: number;
  success: number;
  failed: number;
  tests: number;
  testsPassed: number;
  testsFailed: number;
};

function formatAssertMarkdown(assert: ParsedAssert, indent: string): string {
  const status = assert.pass ? 'PASS' : 'FAIL';
  return `${indent}- **${status}** ${escapeCell(assert.message)}`;
}

function formatTestGroupMarkdown(test: ParsedTestGroup): string[] {
  const status = test.pass ? 'PASS' : 'FAIL';
  const lines = [`- **${status}** ${escapeCell(test.name)}`];
  for (const assert of test.asserts) {
    lines.push(formatAssertMarkdown(assert, '  '));
  }
  return lines;
}

function formatTestsSection(item: KulalaResponseItem): string {
  if (!('scriptConsole' in item) || !item.scriptConsole?.length) {
    return '';
  }

  const tree = parseAssertionTree(item.scriptConsole);
  if (tree.tests.length === 0 && tree.standaloneAsserts.length === 0) {
    return '';
  }

  const lines: string[] = [];
  for (const test of tree.tests) {
    lines.push(...formatTestGroupMarkdown(test));
  }
  for (const assert of tree.standaloneAsserts) {
    lines.push(formatAssertMarkdown(assert, ''));
  }

  return `#### Tests\n\n${lines.join('\n')}\n`;
}

function formatScriptSection(item: KulalaResponseItem, requestFile?: string): string {
  if (!('scriptConsole' in item) || !item.scriptConsole?.length) {
    return '';
  }

  const { pre, post } = splitScriptConsole(item.scriptConsole);
  const parts: string[] = [];

  const formatLines = (lines: typeof pre) =>
    lines
      .map((line) => {
        const origin = formatScriptOrigin(line.origin, requestFile);
        return `- **${line.level.toUpperCase()}** \`${escapeCell(origin)}\` ${escapeCell(line.message)}`;
      })
      .join('\n');

  if (pre.length > 0) {
    parts.push(`##### Pre-request script\n\n${formatLines(pre)}`);
  }
  if (post.length > 0) {
    parts.push(`##### Post-request script\n\n${formatLines(post)}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `#### Script output\n\n${parts.join('\n\n')}\n`;
}

function formatItemSection(item: KulalaResponseItem, requestFile?: string): string {
  const parts: string[] = [`## ${escapeCell(itemTitle(item))}\n`];
  const rows: string[][] = [['Field', 'Value']];

  if ('blockName' in item && item.blockName) {
    rows.push(['Name', escapeCell(item.blockName)]);
  }

  if (isWebSocketResponse(item)) {
    rows.push(['URL', escapeCell(item.url)]);
    if (item.error) {
      rows.push(['Error', escapeCell(item.error)]);
    }
  } else if (isErrorResponse(item)) {
    rows.push(['Error', escapeCell(item.error)]);
    if (item.url) {
      rows.push(['URL', escapeCell(item.url)]);
    }
    if (item.status !== undefined) {
      rows.push(['Status', String(item.status)]);
    }
  } else if (isPromptResponse(item)) {
    rows.push(['Message', escapeCell(item.message)]);
  } else if (isSkippedResponse(item)) {
    rows.push(['Status', 'skipped']);
  } else if (isSuccessResponse(item)) {
    rows.push(['URL', escapeCell(item.url)]);
    rows.push(['Status', String(item.status)]);
    if (item.timings?.total !== undefined) {
      rows.push(['Duration', formatMs(item.timings.total)]);
    }
  }

  parts.push(mdTable(rows));
  parts.push('');

  if (isWebSocketResponse(item) && item.transcript?.length) {
    const lines = item.transcript
      .map((event) => {
        if (event.type === 'sent') return `--> ${event.data ?? ''}`;
        if (event.type === 'message') return `<-- ${event.data ?? ''}`;
        if (event.type === 'waiting') {
          return `Waiting for ${event.remaining ?? 0} server message(s)`;
        }
        if (event.type === 'script-done') return 'Script finished.';
        if (event.type === 'error') return event.error ?? 'WebSocket error';
        return undefined;
      })
      .filter((line): line is string => Boolean(line));
    if (lines.length > 0) {
      parts.push('#### WebSocket transcript\n');
      parts.push('```');
      parts.push(lines.join('\n'));
      parts.push('```');
      parts.push('');
    }
  }

  if ('body' in item && item.body) {
    const body = 'filteredBody' in item && item.filteredBody ? item.filteredBody : item.body;
    const text = responseBodyText(body);
    if (text) {
      const lang = responseBodyLanguage(body);
      parts.push(`#### Response body\n`);
      parts.push(`\`\`\`${lang}`);
      parts.push(text);
      parts.push('```');
      parts.push('');
    }
  }

  const tests = formatTestsSection(item);
  if (tests) {
    parts.push(tests);
  }

  const script = formatScriptSection(item, requestFile);
  if (script) {
    parts.push(script);
  }

  return parts.join('\n');
}

function formatSummary(stats: ReportStats): string {
  const rows = [
    ['', 'Total', 'Successful', 'Failed'],
    ['Requests', String(stats.total), String(stats.success), String(stats.failed)],
  ];

  if (stats.tests > 0) {
    rows.push(['Tests', String(stats.tests), String(stats.testsPassed), String(stats.testsFailed)]);
  }

  return `## Summary\n\n${mdTable(rows)}\n`;
}

function collectTestStats(item: KulalaResponseItem, stats: ReportStats): void {
  if (!('scriptConsole' in item) || !item.scriptConsole?.length) {
    return;
  }

  const tree = parseAssertionTree(item.scriptConsole);
  for (const test of tree.tests) {
    stats.tests += 1;
    if (test.pass) {
      stats.testsPassed += 1;
    } else {
      stats.testsFailed += 1;
    }
  }
}

export function printReport(results: RunFileResult[]): void {
  const parts: string[] = ['# Requests report\n'];
  const stats: ReportStats = {
    total: 0,
    success: 0,
    failed: 0,
    tests: 0,
    testsPassed: 0,
    testsFailed: 0,
  };

  for (const result of results) {
    if (results.length > 1) {
      parts.push(`### File: ${result.filepath}\n`);
    }

    const items = result.response.type === 'error' ? result.response.data : result.response.data;
    for (const item of items) {
      parts.push(formatItemSection(item, result.filepath));
      stats.total += 1;
      if (isResponseSuccessful(item)) {
        stats.success += 1;
      } else {
        stats.failed += 1;
      }
      collectTestStats(item, stats);
    }
  }

  parts.push(formatSummary(stats));
  console.log(parts.join('\n'));
}
