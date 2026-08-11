import path from 'node:path';
import pc from 'picocolors';
import type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaResponseBody,
  KulalaResponseItem,
  KulalaScriptConsoleLine,
  KulalaScriptConsoleOrigin,
} from '../kulala-core/types';

export function isPromptResponse(
  item: KulalaResponseItem,
): item is Extract<KulalaResponseItem, { prompt: true }> {
  if ('prompt' in item && item.prompt === true) {
    return true;
  }
  const maybe = item as { promptId?: string; promptType?: string };
  return Boolean(maybe.promptId && maybe.promptType);
}

export function findFirstPromptItem(
  wrapper: KulalaResponseItem[] | { type: string; data: KulalaResponseItem[] },
): Extract<KulalaResponseItem, { prompt: true }> | undefined {
  const items = Array.isArray(wrapper) ? wrapper : wrapper.data;
  return items.find((item) => isPromptResponse(item));
}

export function isSkippedResponse(
  item: KulalaResponseItem,
): item is Extract<KulalaResponseItem, { skipped: true }> {
  return 'skipped' in item && item.skipped === true;
}

export function isWebSocketResponse(
  item: KulalaResponseItem,
): item is Extract<KulalaResponseItem, { protocol: 'websocket' }> {
  return 'protocol' in item && item.protocol === 'websocket';
}

export function isErrorResponse(item: KulalaResponseItem): item is KulalaRequestErrorResponse {
  return item.success === false && !isPromptResponse(item);
}

export function isSuccessResponse(item: KulalaResponseItem): item is KulalaRequestSuccessResponse {
  return item.success === true && !isSkippedResponse(item) && !isWebSocketResponse(item);
}

export function responseBodyText(body: KulalaResponseBody | undefined): string {
  if (!body) {
    return '';
  }
  if (body.type === 'json') {
    return body.formatted ?? JSON.stringify(body.content, null, 2);
  }
  if (body.type === 'binary') {
    return '';
  }
  return body.content;
}

export function responseBodyLanguage(body: KulalaResponseBody | undefined): string {
  if (!body) {
    return 'text';
  }
  if (body.type === 'json') {
    return 'json';
  }
  if (body.type === 'binary') {
    return 'text';
  }
  const mediaType = body.mediaType?.toLowerCase() ?? '';
  if (mediaType.includes('json')) {
    return 'json';
  }
  if (mediaType.includes('xml')) {
    return 'xml';
  }
  if (mediaType.includes('html')) {
    return 'html';
  }
  if (mediaType.includes('javascript') || mediaType.includes('ecmascript')) {
    return 'javascript';
  }
  if (mediaType.includes('graphql')) {
    return 'graphql';
  }
  return 'text';
}

export function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function mdTable(rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }

  const header = rows[0];
  const separator = header.map(() => '---');
  const body = rows.slice(1);

  const formatRow = (row: string[]) => `| ${row.join(' | ')} |`;

  return [formatRow(header), formatRow(separator), ...body.map(formatRow)].join('\n');
}

export type ParsedAssert = {
  pass: boolean;
  message: string;
};

export type ParsedTestGroup = {
  pass: boolean;
  name: string;
  error?: string;
  asserts: ParsedAssert[];
};

export type ParsedAssertionTree = {
  tests: ParsedTestGroup[];
  standaloneAsserts: ParsedAssert[];
};

export type ParsedTestResult = {
  pass: boolean;
  name: string;
  error?: string;
};

export function isStructuredScriptLine(line: KulalaScriptConsoleLine): boolean {
  return (
    (line.kind === 'test' || line.kind === 'assert') &&
    (line.status === 'pass' || line.status === 'fail')
  );
}

function finalizeOpenTest(openTest: ParsedTestGroup | null, tests: ParsedTestGroup[]): void {
  if (!openTest) {
    return;
  }
  if (!tests.includes(openTest)) {
    tests.push(openTest);
  }
}

function assertMessageAlreadyShown(message: string, tests: ParsedTestGroup[]): boolean {
  return tests.some(
    (test) => test.error === message || test.asserts.some((assert) => assert.message === message),
  );
}

export function parseAssertionTree(
  lines: KulalaScriptConsoleLine[] | undefined,
): ParsedAssertionTree {
  const tests: ParsedTestGroup[] = [];
  const standaloneAsserts: ParsedAssert[] = [];
  let openTest: ParsedTestGroup | null = null;
  const hasStructuredOutput = (lines ?? []).some(
    (line) => line.kind === 'assert' || line.kind === 'test',
  );

  for (const line of lines ?? []) {
    if (line.kind === 'assert') {
      const assert: ParsedAssert = {
        pass: line.status === 'pass',
        message: line.message,
      };

      if (line.testName) {
        if (!openTest || openTest.name !== line.testName) {
          finalizeOpenTest(openTest, tests);
          openTest = { name: line.testName, pass: true, asserts: [] };
        }
        openTest.asserts.push(assert);
        if (!assert.pass) {
          openTest.pass = false;
        }
      } else {
        finalizeOpenTest(openTest, tests);
        openTest = null;
        standaloneAsserts.push(assert);
      }
      continue;
    }

    if (line.kind === 'test') {
      const parsed = {
        pass: line.status === 'pass',
        name: line.testName,
        error: line.status === 'fail' && line.level === 'error' ? line.message : undefined,
      };

      if (openTest && openTest.name === parsed.name) {
        openTest.pass = parsed.pass;
        openTest.error = parsed.error;
        if (!parsed.pass && parsed.error && openTest.asserts.length === 0) {
          openTest.asserts.push({ pass: false, message: parsed.error });
        }
        finalizeOpenTest(openTest, tests);
        openTest = null;
        continue;
      }

      finalizeOpenTest(openTest, tests);
      openTest = null;

      if (!parsed.name) continue;

      const testGroup: ParsedTestGroup = {
        name: parsed.name,
        pass: parsed.pass,
        error: parsed.error,
        asserts: [],
      };
      if (!parsed.pass && parsed.error) {
        testGroup.asserts.push({ pass: false, message: parsed.error });
      }
      tests.push(testGroup);
      continue;
    }

    if (line.level === 'error' && line.kind !== 'log') {
      const message = line.message;
      if (hasStructuredOutput || assertMessageAlreadyShown(message, tests)) {
        continue;
      }

      finalizeOpenTest(openTest, tests);
      openTest = null;
      standaloneAsserts.push({
        pass: false,
        message,
      });
    }
  }

  finalizeOpenTest(openTest, tests);
  return { tests, standaloneAsserts };
}

function isPreRequestPhase(origin: KulalaScriptConsoleOrigin | undefined): boolean {
  if (!origin) {
    return false;
  }
  const phase = String(origin.phase);
  return phase === 'preRequest' || phase === 'pre-request' || phase === 'pre_request';
}

function scriptDisplayPath(
  originFile: string | undefined,
  requestFile?: string,
): string | undefined {
  if (!originFile) {
    return undefined;
  }
  if (requestFile) {
    const relative = path.relative(path.dirname(requestFile), originFile);
    if (relative && !relative.startsWith('..')) {
      return relative;
    }
  }
  return originFile.split('/').pop();
}

export function formatScriptOrigin(
  origin: KulalaScriptConsoleOrigin | undefined,
  requestFile?: string,
): string {
  if (!origin) {
    return '[?]';
  }

  const source = origin.source ?? '?';
  const file = scriptDisplayPath(origin.file, requestFile);
  const location =
    origin.line !== undefined
      ? `L${origin.line}${origin.column !== undefined ? `:${origin.column}` : ''}`
      : `directive L${origin.httpDirectiveLine ?? '?'}`;

  return file ? `[${source} · ${file} · ${location}]` : `[${source} · ${location}]`;
}

export function splitScriptConsole(lines: KulalaScriptConsoleLine[] | undefined): {
  pre: KulalaScriptConsoleLine[];
  post: KulalaScriptConsoleLine[];
} {
  const pre: KulalaScriptConsoleLine[] = [];
  const post: KulalaScriptConsoleLine[] = [];
  const hasStructuredOutput = (lines ?? []).some(
    (line) => line.kind === 'assert' || line.kind === 'test',
  );
  const tree = parseAssertionTree(lines);
  const skipScriptErrors = new Set<string>();
  for (const test of tree.tests) {
    if (test.error) {
      skipScriptErrors.add(test.error);
    }
    for (const assert of test.asserts) {
      skipScriptErrors.add(assert.message);
    }
  }
  for (const assert of tree.standaloneAsserts) {
    skipScriptErrors.add(assert.message);
  }

  for (const line of lines ?? []) {
    if (isStructuredScriptLine(line)) {
      continue;
    }

    if (line.level === 'error' && line.message.startsWith('Error executing script: ')) {
      const message = line.message.replace(/^Error executing script: /, '');
      if (hasStructuredOutput || skipScriptErrors.has(message)) {
        continue;
      }
    }

    if (isPreRequestPhase(line.origin)) {
      pre.push(line);
    } else {
      post.push(line);
    }
  }

  return { pre, post };
}

function formatLabeledField(label: string, value: string): string {
  return pc.bold(`${pc.cyan(`${label}:`)} ${value}`);
}

export function formatRunHeader(filepath: string, blockName: string): string {
  return [
    formatLabeledField('Filepath', filepath),
    formatLabeledField('Block name', blockName),
  ].join('\n');
}

export function itemDisplayName(item: KulalaResponseItem): string {
  if ('blockName' in item && item.blockName) {
    return item.blockName;
  }
  return itemTitle(item);
}

export function itemTitle(item: KulalaResponseItem): string {
  if (isPromptResponse(item)) {
    return `Prompt: ${item.promptType}`;
  }
  if (isSkippedResponse(item)) {
    return item.blockName ? `Skipped - ${item.blockName}` : 'Skipped';
  }
  if (isWebSocketResponse(item)) {
    return `WebSocket - ${item.url}`;
  }
  if (isErrorResponse(item)) {
    const method = item.request?.method ?? 'REQUEST';
    const url = item.url ?? item.blockName ?? 'unknown';
    return `${method} ${url}`;
  }
  if (isSuccessResponse(item)) {
    const method = item.request?.method ?? 'GET';
    return `${method} ${item.url}`;
  }
  return 'Unknown request';
}
