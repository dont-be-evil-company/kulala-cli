import { spawnSync } from 'node:child_process';

export type FormatJsonOptions = {
  indent?: number;
  expand_tabs?: boolean;
  sort_keys?: boolean;
  text?: string;
};

let cachedExecutable: string | null = null;

export function setKulalaCoreExecutable(exe: string): void {
  cachedExecutable = exe;
}

/** Pretty-print JSON with the cached kulala-core binary. */
export function formatJsonSync(value: unknown, opts?: FormatJsonOptions): string | undefined {
  if (!cachedExecutable) return undefined;

  const payload: Record<string, unknown> = {
    action: 'format_json',
    indent: opts?.indent,
    expand_tabs: opts?.expand_tabs,
    sort_keys: opts?.sort_keys,
  };
  if (opts?.text !== undefined) payload.text = opts.text;
  else payload.value = value;

  const result = spawnSync(cachedExecutable, [], {
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf-8',
  });
  if (result.status !== 0 || !result.stdout) return undefined;

  try {
    const parsed = JSON.parse(result.stdout) as { success?: boolean; content?: string };
    if (parsed.success === true && typeof parsed.content === 'string') return parsed.content;
  } catch {
    return undefined;
  }
  return undefined;
}
