export type FileEntry = { name: string; kind: "file" | "directory" | "symlink" | "other"; size: number | null; modified: number | null; permissions: number | null };
export type Listing = { path: string; entries: FileEntry[] };
export type Progress = { bytes: number; total: number | null };
export function portableName(name: string): boolean {
  const stem = name.split(".")[0].toUpperCase();
  return !!name && name !== "." && name !== ".." && new TextEncoder().encode(name).length <= 255
    && !/[\x00-\x1f\x7f-\x9f/\\:<>"|?*]/u.test(name) && !/[ .]$/u.test(name)
    && !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9]|LPT[0-9])$/.test(stem);
}
export function childPath(parent: string, name: string, remote: boolean): string {
  if (!portableName(name)) throw new Error("Invalid filename");
  const separator = !remote && parent.includes("\\") ? "\\" : "/";
  return parent.replace(/[\\/]+$/, "") + separator + name;
}
export function parentPath(path: string, remote: boolean): string {
  if (remote) return path.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";
  const normalized = path.replace(/[\\/]+$/, "");
  if (/^(\\\\\?\\)?[a-z]:$/i.test(normalized)) return normalized + "\\";
  const parent = normalized.replace(/[\\/][^\\/]*$/, "") || "/";
  return /^(\\\\\?\\)?[a-z]:$/i.test(parent) ? parent + "\\" : parent;
}
export function transferAllowed(entry: FileEntry | undefined, local: Listing | null, remote: Listing | null, busy: boolean): boolean {
  return !busy && !!local && !!remote && entry?.kind === "file" && portableName(entry.name);
}
export function progressPercent(progress: Progress): number | undefined {
  if (!progress.total || progress.total < 0) return undefined;
  return Math.max(0, Math.min(100, progress.bytes / progress.total * 100));
}
// A synchronous gate prevents rapid clicks and stale callbacks updating a new request.
export class OperationGate {
  id: string | null = null;
  begin(id: string): boolean { if (this.id) return false; this.id = id; return true; }
  owns(id: string): boolean { return this.id === id; }
  finish(id: string): boolean { if (!this.owns(id)) return false; this.id = null; return true; }
}
