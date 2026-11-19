export const REMOTE_CLIPBOARD_LIMIT=64*1024;

/** Treat remote clipboard text as untrusted before offering an explicit copy. */
export function boundedRemoteClipboard(text:string):string {
  if(!text || new TextEncoder().encode(text).length>REMOTE_CLIPBOARD_LIMIT ||
      /[\u0000\u001b\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text))
    throw new Error("Unsafe or oversized remote clipboard text");
  return text;
}
