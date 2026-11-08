/**
 * The Guacamole tunnel is a separate authenticated application gateway, NOT
 * a raw RDP port. All auth to its WSS endpoint must already be configured
 * in the gateway/WebView OS context. We never embed tokens in a URL.
 */
export function guacamoleWssEndpoint(value: string): string {
  if (typeof value !== "string" || !value.startsWith("wss://") ||
      value !== value.trim() || value.length > 2048 ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Only an explicit wss:// Guacamole tunnel is allowed");
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Invalid Guacamole tunnel URL"); }
  if (!url.hostname || url.protocol !== "wss:" || url.username ||
      url.password || url.search || url.hash ||
      /%2f|%5c|%00/i.test(url.pathname)) {
    throw new Error("Guacamole tunnel URL must not contain credentials, tokens or fragments");
  }
  return url.href;
}
