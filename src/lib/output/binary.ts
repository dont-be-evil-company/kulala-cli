import type { KulalaResponseBody } from '../kulala-core/types';
import { kulalaCore } from '../kulala-core';

export type TerminalImageProtocol = 'kitty' | 'iterm2' | 'wezterm' | 'ghostty';

export type RenderedInlineImage = {
  content: string;
  /** Present when the image was transcoded for Kitty/Ghostty inline display. */
  convertedFrom?: 'jpeg';
};

type BinaryImageBody = Extract<KulalaResponseBody, { type: 'binary' }>;

function isGhostty(): boolean {
  if (
    process.env.GHOSTTY_RESOURCES_DIR ||
    process.env.GHOSTTY_BIN_DIR ||
    process.env.GHOSTTY_SHELL_FEATURES
  ) {
    return true;
  }
  if ((process.env.TERM ?? '').includes('ghostty')) {
    return true;
  }
  return (process.env.TERM_PROGRAM ?? '').toLowerCase().includes('ghostty');
}

function isKitty(): boolean {
  if (process.env.KITTY_WINDOW_ID || process.env.KITTY_PID) {
    return true;
  }
  if ((process.env.TERM ?? '').includes('xterm-kitty')) {
    return true;
  }
  return (process.env.TERM_PROGRAM ?? '').toLowerCase() === 'kitty';
}

function isWezTerm(): boolean {
  if (process.env.WEZTERM_EXECUTABLE || process.env.WEZTERM_PANE) {
    return true;
  }
  return (process.env.TERM_PROGRAM ?? '').toLowerCase().includes('wezterm');
}

export function detectTerminalImageProtocol(): TerminalImageProtocol | null {
  if (isKitty()) {
    return 'kitty';
  }
  // Ghostty uses the Kitty graphics protocol.
  if (isGhostty()) {
    return 'ghostty';
  }
  // WezTerm supports the iTerm2 inline image protocol (and optionally Kitty graphics).
  // iTerm2 OSC 1337 works without extra config on all platforms.
  if (isWezTerm()) {
    return 'wezterm';
  }
  // iTerm2 (macOS) – common env signals.
  if (process.env.TERM_PROGRAM === 'iTerm.app' || process.env.ITERM_SESSION_ID) {
    return 'iterm2';
  }
  return null;
}

export function isBinaryBody(
  body: KulalaResponseBody | undefined,
): body is Extract<KulalaResponseBody, { type: 'binary' }> {
  return body?.type === 'binary';
}

export function isImageBody(body: KulalaResponseBody | undefined): boolean {
  if (!body || (body.type !== 'text' && body.type !== 'binary')) {
    return false;
  }
  const mediaType = body.mediaType?.toLowerCase() ?? '';
  return mediaType.startsWith('image/');
}

function isPngImage(body: BinaryImageBody): boolean {
  const mediaType = body.mediaType?.toLowerCase() ?? '';
  if (mediaType === 'image/png') {
    return true;
  }
  return body.content.startsWith('iVBORw0KGgo');
}

function usesKittyGraphicsProtocol(protocol: TerminalImageProtocol): boolean {
  return protocol === 'kitty' || protocol === 'ghostty';
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function kittyImageEscape(base64: string): string {
  // Kitty graphics protocol: transmit base64 PNG chunks.
  // https://sw.kovidgoyal.net/kitty/graphics-protocol/
  // f=100 is required for PNG; without it terminals default to raw RGBA (f=32).
  const CHUNK = 4096;
  let out = '';
  let offset = 0;
  let first = true;
  while (offset < base64.length) {
    const chunk = base64.slice(offset, offset + CHUNK);
    offset += CHUNK;
    const more = offset < base64.length ? 1 : 0;
    if (first) {
      out += `\u001b_Ga=T,f=100,m=${more};${chunk}\u001b\\`;
      first = false;
    } else {
      out += `\u001b_Gm=${more};${chunk}\u001b\\`;
    }
  }
  return out;
}

function iterm2ImageEscape(base64: string, byteLength: number): string {
  // iTerm2 inline images (OSC 1337).
  // https://iterm2.com/documentation-images.html
  return `\u001b]1337;File=inline=1;size=${byteLength};width=auto;height=auto;preserveAspectRatio=1:${base64}\u0007`;
}

export async function renderImageInline(
  body: BinaryImageBody,
): Promise<RenderedInlineImage | null> {
  const protocol = detectTerminalImageProtocol();
  if (!protocol) return null;
  if (body.encoding !== 'base64') return null;

  if (usesKittyGraphicsProtocol(protocol)) {
    let base64 = body.content;
    let convertedFrom: 'jpeg' | undefined;

    if (!isPngImage(body)) {
      const converted = await kulalaCore.convertImage({
        content: body.content,
        mediaType: body.mediaType,
        target: 'png',
      });
      if (!converted) {
        return null;
      }
      base64 = converted.content;
      convertedFrom = converted.convertedFrom;
    }

    return { content: kittyImageEscape(base64), convertedFrom };
  }

  if (protocol === 'iterm2' || protocol === 'wezterm') {
    return { content: iterm2ImageEscape(body.content, body.byteLength) };
  }

  return null;
}
