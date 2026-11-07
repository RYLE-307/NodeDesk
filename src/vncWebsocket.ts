/**
 * Embedded VNC requires a TLS-authenticated WebSocket endpoint.
 * Browser/WebView verifies the server certificate; never downgrade to ws:.
 * URL credentials, tokens in queries or fragments are forbidden to avoid
 * leaking passwords to browser history, proxies, logs or the connection UI.
 */
export function vncWebsocketEndpoint(input: string): string {
  if (typeof input !== "string" || !input || input !== input.trim() ||
      input.length > 2048 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error("Enter a valid WSS endpoint without whitespace or control characters");
  }
  let url: URL;
  try { url = new URL(input); }
  catch { throw new Error("Invalid WebSocket URL"); }
  if (url.protocol !== "wss:" || !url.hostname ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Only wss:// URLs without credentials, query parameters or fragments are allowed");
  }
  // Reject delimiter ambiguities, including encoded path delimiters that can
  // be reinterpreted by reverse proxies.
  if (/%2f|%5c|%00/i.test(url.pathname)) {
    throw new Error("Encoded path separators are not allowed");
  }
  return url.href;
}
