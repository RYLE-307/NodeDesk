export const RDP_CLIPBOARD_LIMIT=64*1024;

/** Treat remote clipboard text as untrusted before offering an explicit copy. */
export function boundedRdpClipboard(text:string):string {
  if(!text || new TextEncoder().encode(text).length>RDP_CLIPBOARD_LIMIT ||
      /[\u0000\u001b\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text))
    throw new Error("Unsafe or oversized RDP clipboard text");
  return text;
}
