import pc from 'picocolors';
import type {
  KulalaResponseBody,
  KulalaResponseItem,
  KulalaResponseWrapper,
  KulalaScriptConsoleLine,
  RunFileResult,
} from '../kulala-core/types';
import { highlightCode } from './highlight';
import { formatByteSize, isBinaryBody, isImageBody, renderImageInline } from './binary';
import {
  formatMs,
  formatRunHeader,
  formatScriptOrigin,
  itemDisplayName,
  isErrorResponse,
  isPromptResponse,
  isSkippedResponse,
  isSuccessResponse,
  isWebSocketResponse,
  parseAssertionTree,
  responseBodyLanguage,
  responseBodyText,
  splitScriptConsole,
  type ParsedAssertionTree,
  type ParsedAssert,
  type ParsedTestGroup,
} from './shared';

function statusColor(status: number): (text: string) => string {
  if (status >= 200 && status < 300) {
    return pc.green;
  }
  if (status >= 300 && status < 400) {
    return pc.yellow;
  }
  return pc.red;
}

function formatSection(title: string, content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }

  const underline = '─'.repeat(Math.max(title.length, 12));
  return `${pc.bold(title)}\n${pc.dim(underline)}\n${trimmed}`;
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => pc.dim(`${name}: ${value}`))
    .join('\n');
}

async function formatBody(body: KulalaResponseBody | undefined): Promise<string> {
  if (isBinaryBody(body)) {
    const mediaType = body.mediaType ?? 'application/octet-stream';
    if (isImageBody(body)) {
      const rendered = await renderImageInline(body);
      if (rendered) {
        const parts: string[] = [];
        if (rendered.convertedFrom === 'jpeg') {
          parts.push(pc.yellow('! Converted JPEG to PNG for terminal compatibility'));
        }
        parts.push(rendered.content);
        return parts.join('\n');
      }
    }
    return pc.dim(
      `Binary response body omitted (${mediaType}, ${formatByteSize(body.byteLength)})`,
    );
  }
  const text = responseBodyText(body);
  if (!text) {
    return '';
  }
  return highlightCode(text, responseBodyLanguage(body));
}

const GROUP_SYMBOL = '';
const PASS_SYMBOL = '✓';
const FAIL_SYMBOL = '✗';

function formatAssertLine(assert: ParsedAssert, indent: string): string {
  if (assert.pass) {
    return pc.green(`${indent}${PASS_SYMBOL} ${assert.message}`);
  }
  return pc.red(`${indent}${FAIL_SYMBOL} ${assert.message}`);
}

function formatTestGroup(test: ParsedTestGroup): string[] {
  const lines: string[] = [];

  lines.push(
    test.pass
      ? pc.green(`${PASS_SYMBOL} ${GROUP_SYMBOL} ${test.name}`)
      : pc.red(`${FAIL_SYMBOL} ${GROUP_SYMBOL} ${test.name}`),
  );

  for (const assert of test.asserts) {
    lines.push(formatAssertLine(assert, '  '));
  }

  return lines;
}

function formatTestsAndAsserts(tree: ParsedAssertionTree): string {
  const lines: string[] = [];

  for (const test of tree.tests) {
    lines.push(...formatTestGroup(test));
  }

  for (const assert of tree.standaloneAsserts) {
    lines.push(formatAssertLine(assert, '  '));
  }

  return lines.join('\n');
}

function formatScriptLine(line: KulalaScriptConsoleLine, requestFile?: string): string {
  const prefix =
    line.level === 'error'
      ? pc.red('[error]')
      : line.level === 'warn'
        ? pc.yellow('[warn]')
        : line.level === 'info'
          ? pc.blue('[info]')
          : line.level === 'debug'
            ? pc.dim('[debug]')
            : pc.dim('[log]');

  const origin = pc.dim(formatScriptOrigin(line.origin, requestFile));
  return `  ${prefix} ${origin} ${line.message}`;
}

function formatScriptLines(lines: KulalaScriptConsoleLine[], requestFile?: string): string {
  if (lines.length === 0) {
    return '';
  }
  return lines.map((line) => formatScriptLine(line, requestFile)).join('\n');
}

function formatScriptOutput(
  lines: KulalaScriptConsoleLine[] | undefined,
  requestFile?: string,
): string {
  const { pre, post } = splitScriptConsole(lines);
  const parts: string[] = [];

  const preText = formatScriptLines(pre, requestFile);
  if (preText) {
    parts.push(pc.dim('Pre-request'));
    parts.push(preText);
  }

  const postText = formatScriptLines(post, requestFile);
  if (postText) {
    if (parts.length > 0) {
      parts.push('');
    }
    parts.push(pc.dim('Post-request'));
    parts.push(postText);
  }

  return parts.join('\n');
}

function formatStatusLine(status: number, httpVersion?: string, failed = false): string {
  const label = httpVersion ? `${httpVersion} ${status}` : `HTTP ${status}`;
  return failed ? pc.red(label) : statusColor(status)(label);
}

function formatRequestHeader(
  method: string,
  url: string,
  status?: number,
  durationMs?: number,
  failed = false,
  httpVersion?: string,
): string {
  const lines = [`${pc.bold(method)} ${url}`];

  if (status !== undefined) {
    const statusText = formatStatusLine(status, httpVersion, failed);
    const duration = durationMs !== undefined ? pc.dim(` · ${formatMs(durationMs)}`) : '';
    lines.push(`${statusText}${duration}`);
  }

  return lines.join('\n');
}

async function appendHttpResponseDetails(
  parts: string[],
  item: {
    headers?: Record<string, string>;
    body?: KulalaResponseBody;
    filteredBody?: KulalaResponseBody;
  },
): Promise<void> {
  if (item.headers && Object.keys(item.headers).length > 0) {
    parts.push('');
    parts.push(formatSection('Headers', formatHeaders(item.headers)));
  }

  const bodySection = await formatBody(item.filteredBody ?? item.body);
  if (bodySection) {
    parts.push('');
    parts.push(formatSection('Response body', bodySection));
  }
}

function appendScriptSections(
  parts: string[],
  scriptConsole: KulalaScriptConsoleLine[] | undefined,
  requestFile?: string,
): void {
  const tree = parseAssertionTree(scriptConsole);
  const testsSection = formatTestsAndAsserts(tree);
  const scriptSection = formatScriptOutput(scriptConsole, requestFile);

  if (testsSection) {
    parts.push('');
    parts.push(formatSection('Tests', testsSection));
  }
  if (scriptSection) {
    parts.push('');
    parts.push(formatSection('Script output', scriptSection));
  }
}

async function formatItem(item: KulalaResponseItem, requestFile?: string): Promise<string> {
  const header = requestFile ? `${formatRunHeader(requestFile, itemDisplayName(item))}\n` : '';

  if (isPromptResponse(item)) {
    const parts = [header + pc.yellow(`Prompt (${item.promptType}): ${item.message}`)];
    for (const input of item.inputs) {
      parts.push(`  - ${input.label} (${input.type}${input.required ? ', required' : ''})`);
    }
    return parts.join('\n');
  }

  if (isSkippedResponse(item)) {
    const parts = [header + pc.dim(`Skipped${item.blockName ? ` · ${item.blockName}` : ''}`)];
    appendScriptSections(parts, item.scriptConsole, requestFile);
    return parts.join('\n');
  }

  if (isWebSocketResponse(item)) {
    const parts = [header + pc.cyan(`WebSocket: ${item.url}`)];
    if (item.initialMessage) {
      parts.push(pc.dim(`Initial message: ${item.initialMessage}`));
    }
    return parts.join('\n');
  }

  if (isErrorResponse(item)) {
    const method = item.request?.method ?? 'GET';
    const parts = [
      header +
        formatRequestHeader(
          method,
          item.url ?? item.blockName ?? 'unknown',
          item.status,
          item.timings?.total,
          true,
          item.httpVersion,
        ),
    ];

    if (item.error) {
      parts.push(pc.red(`Error: ${item.error}`));
    }

    await appendHttpResponseDetails(parts, item);
    appendScriptSections(parts, item.scriptConsole, requestFile);
    return parts.join('\n');
  }

  if (isSuccessResponse(item)) {
    const method = item.request?.method ?? 'GET';
    const parts = [
      header +
        formatRequestHeader(
          method,
          item.url,
          item.status,
          item.timings?.total,
          false,
          item.httpVersion,
        ),
    ];

    await appendHttpResponseDetails(parts, item);
    appendScriptSections(parts, item.scriptConsole, requestFile);
    return parts.join('\n');
  }

  return header + pc.dim('Unknown response type');
}

async function formatWrapper(
  wrapper: KulalaResponseWrapper,
  requestFile?: string,
): Promise<string> {
  const items = wrapper.type === 'error' ? wrapper.data : wrapper.data;
  const formatted = await Promise.all(items.map((entry) => formatItem(entry, requestFile)));
  return formatted.join('\n\n');
}

export async function printResponseItems(
  filepath: string,
  items: KulalaResponseItem[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  console.log(await formatWrapper({ type: 'responses', data: items }, filepath));
}

export async function printHumanReadable(results: RunFileResult[]): Promise<void> {
  const blocks = await Promise.all(
    results.map((result) => formatWrapper(result.response, result.filepath)),
  );
  console.log(blocks.join('\n\n'));
}

export function printJson(results: RunFileResult[]): void {
  const payload = results.length === 1 ? results[0].response : results;
  console.log(JSON.stringify(payload, null, 2));
}

export function isResponseSuccessful(item: KulalaResponseItem): boolean {
  if (isPromptResponse(item)) {
    return false;
  }
  return item.success === true;
}

function filterFailedWrapper(wrapper: KulalaResponseWrapper): KulalaResponseWrapper | null {
  const items = wrapper.type === 'error' ? wrapper.data : wrapper.data;
  const failed = items.filter((item) => !isResponseSuccessful(item));
  if (failed.length === 0) {
    return null;
  }
  return { type: 'responses', data: failed };
}

export function filterFailedResults(results: RunFileResult[]): RunFileResult[] {
  return results.flatMap((result) => {
    const filtered = filterFailedWrapper(result.response);
    if (!filtered) {
      return [];
    }
    return [{ filepath: result.filepath, response: filtered }];
  });
}

export function countResults(wrapper: KulalaResponseWrapper): {
  total: number;
  success: number;
  failed: number;
} {
  const items = wrapper.type === 'error' ? wrapper.data : wrapper.data;
  let success = 0;
  let failed = 0;

  for (const item of items) {
    if (isResponseSuccessful(item)) {
      success += 1;
    } else {
      failed += 1;
    }
  }

  return { total: items.length, success, failed };
}

export { formatMs, responseBodyText };
