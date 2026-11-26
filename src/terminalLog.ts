/**
 * Only rendered terminal scrollback is exported. This is never automatic
 * process logging and does not capture keystrokes not displayed by xterm.
 */
export const MAX_TERMINAL_LOG_BYTES = 512 * 1024;
export const MAX_TERMINAL_LOG_LINES = 4096;

export interface TerminalDisplayLine {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}
export interface TerminalDisplayBuffer {
  readonly length: number;
  getLine(index: number): TerminalDisplayLine | undefined;
}
export type TerminalLog = { text: string; truncated: boolean };

export function collectTerminalScrollback(buffer: TerminalDisplayBuffer): TerminalLog {
  if (!Number.isSafeInteger(buffer.length) || buffer.length < 0)
    throw new Error("Invalid terminal buffer");
  const start = Math.max(0, buffer.length - MAX_TERMINAL_LOG_LINES);
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  let truncated = start > 0;
  let newerLineWrapped = false;
  // Preserve the newest screen history if the byte or line cap is reached.
  for (let i = buffer.length - 1; i >= start; i--) {
    const line = buffer.getLine(i);
    if (!line) { truncated = true; break; }
    const text = line.translateToString(true);
    const fragment = text + (chunks.length && !newerLineWrapped ? "\n" : "");
    const length = encoder.encode(fragment).byteLength;
    if (bytes + length > MAX_TERMINAL_LOG_BYTES) {
      truncated = true;
      break;
    }
    bytes += length;
    chunks.unshift(fragment);
    newerLineWrapped = line.isWrapped;
  }
  const text = chunks.join("");
  return { text: text.trim() ? text : "", truncated };
}
