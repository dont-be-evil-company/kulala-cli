export type KulalaResponseBody =
  | { type: 'text'; content: string; mediaType?: string }
  | {
      type: 'binary';
      /** Base64-encoded bytes. */
      content: string;
      encoding: 'base64';
      byteLength: number;
      mediaType?: string;
    }
  | { type: 'json'; content: Record<string, unknown>; formatted?: string };

export type KulalaScriptConsoleOrigin = {
  phase: string;
  source?: string;
  file?: string;
  httpDirectiveLine?: number;
  line?: number;
  column?: number;
  type?: string;
  name?: string;
};

export type KulalaScriptConsoleLine = {
  level: 'log' | 'error' | 'warn' | 'info' | 'debug';
  message: string;
  origin: KulalaScriptConsoleOrigin;
  kind?: 'log' | 'test' | 'assert';
  testName?: string;
  status?: 'pass' | 'fail';
};

export type KulalaRequestSuccessResponse = {
  success: true;
  blockName?: string;
  status: number;
  /** Protocol version from the response status line (e.g. HTTP/2). */
  httpVersion?: string;
  headers: Record<string, string>;
  url: string;
  request?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  timings: {
    dns: number;
    tcp: number;
    tls: number;
    request: number;
    redirect: number;
    firstByte: number;
    startTransfer: number;
    total: number;
  };
  body: KulalaResponseBody;
  filteredBody?: KulalaResponseBody;
  scriptConsole?: KulalaScriptConsoleLine[];
};

export type KulalaRequestErrorResponse = {
  success: false;
  blockName?: string;
  error: string;
  scriptConsole?: KulalaScriptConsoleLine[];
  httpCompleted?: boolean;
  status?: number;
  httpVersion?: string;
  headers?: Record<string, string>;
  url?: string;
  request?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  timings?: KulalaRequestSuccessResponse['timings'];
  body?: KulalaResponseBody;
  filteredBody?: KulalaResponseBody;
};

export type KulalaPromptResponse = {
  success: false;
  prompt: true;
  promptId: string;
  promptType: string;
  message: string;
  blockName?: string;
  inputs: Array<{
    id: string;
    label: string;
    type: 'text' | 'password' | 'url';
    required?: boolean;
  }>;
};

export type KulalaSkippedResponse = {
  success: true;
  skipped: true;
  blockName?: string;
  scriptConsole?: KulalaScriptConsoleLine[];
};

export type KulalaWebSocketMessage = {
  waitForServer: number;
  data: string;
};

export type KulalaWebSocketTranscriptEntry = {
  type: string;
  data?: string;
  error?: string;
  remaining?: number;
  code?: number;
};

export type KulalaWebSocketPlanResponse = {
  success: boolean;
  protocol: 'websocket';
  url: string;
  initialMessage?: string;
  messages?: KulalaWebSocketMessage[];
  timeoutMs?: number;
  error?: string;
  transcript?: KulalaWebSocketTranscriptEntry[];
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

export type KulalaResponseItem =
  | KulalaRequestSuccessResponse
  | KulalaRequestErrorResponse
  | KulalaPromptResponse
  | KulalaSkippedResponse
  | KulalaWebSocketPlanResponse;

export type KulalaResponseWrapper =
  | { type: 'responses'; data: KulalaResponseItem[] }
  | { type: 'error'; data: KulalaRequestErrorResponse[] };

export type RunLimit =
  | { filter: 'name'; name: string }
  | { filter: 'cursorPosition'; line: number; column: number };

export type KulalaEnvironmentCatalog = {
  $kulalaShared?: Record<string, unknown>;
  environments: Record<string, Record<string, unknown>>;
};

export type RunOptions = {
  content: string;
  filepath: string;
  env?: string;
  limit?: RunLimit[];
  haltOnError?: boolean;
};

export type RunFileResult = {
  filepath: string;
  response: KulalaResponseWrapper;
  /** Human-readable output was already printed block-by-block during prompt handling. */
  outputStreamed?: boolean;
};
