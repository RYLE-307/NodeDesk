/** Command snippets are inserted only after explicit consent and without Enter. */
export const MAX_SNIPPET_BYTES = 4096;
export function prepareTerminalSnippet(value: string): string {
  if (typeof value !== "string" || !value.trim() ||
      value.length > MAX_SNIPPET_BYTES ||
      new TextEncoder().encode(value).length > MAX_SNIPPET_BYTES ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error("Invalid terminal snippet");
  }
  return value;
}
