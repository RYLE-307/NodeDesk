/**
 * Classify clipboard text before it reaches xterm's paste handler.
 * This is a UI safety guard, not shell sanitization; typed input still works.
 */
export const MAX_TERMINAL_PASTE_BYTES = 16 * 1024;
export type TerminalPasteDecision = "allow" | "confirm" | "reject-control" | "reject-size";

export function decideTerminalPaste(text: string): TerminalPasteDecision {
  // Check UTF-16 length first to avoid allocating huge UTF-8 buffers.
  if (text.length > MAX_TERMINAL_PASTE_BYTES ||
      new TextEncoder().encode(text).length > MAX_TERMINAL_PASTE_BYTES) {
    return "reject-size";
  }
  // Do not paste terminal escape/control sequences or bidi overrides.
  // CR, LF and TAB are handled separately (CR/LF require confirmation).
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)) {
    return "reject-control";
  }
  return /[\r\n]/u.test(text) ? "confirm" : "allow";
}
