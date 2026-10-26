import { createDaemonClient, defaultKulalaCoreDataDir, type DaemonClient } from './daemon-client';

export type FormatJsonOptions = {
  indent?: number;
  expand_tabs?: boolean;
  sort_keys?: boolean;
  text?: string;
};

let cachedExecutable: string | null = null;
let daemon: DaemonClient | null = null;

function daemonClient(): DaemonClient | null {
  if (!cachedExecutable) return null;
  const exe = cachedExecutable;
  if (!daemon) {
    daemon = createDaemonClient({
      clientName: 'kulala-cli',
      dataDir: defaultKulalaCoreDataDir,
      executable: () => exe,
    });
  }
  return daemon;
}

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

  const daemon = daemonClient();
  if (!daemon) return undefined;
  const result = daemon.invokeSync(payload);
  if (result.code !== 0 || !result.stdout) return undefined;

  try {
    const parsed = JSON.parse(result.stdout) as { success?: boolean; content?: string };
    if (parsed.success === true && typeof parsed.content === 'string') return parsed.content;
  } catch {
    return undefined;
  }
  return undefined;
}
