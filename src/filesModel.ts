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

/** Client-side view only: never changes the authoritative loaded directory. */
export function visibleEntries(entries: FileEntry[], filter: string): FileEntry[] {
  const needle = filter.trim().toLocaleLowerCase();
  return entries
    .filter(entry => !needle || entry.name.toLocaleLowerCase().includes(needle))
    .sort((a,b) => {
      const aFolder = a.kind === "directory", bFolder = b.kind === "directory";
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"});
    });
}

/** A bounded, immutable queue plan. All files must be valid and collision-free.
 * The backend rechecks paths and collisions immediately before each operation.
 * Never silently skip or overwrite a file in a multi-file batch.
 */
export function transferBatchPlan(names: readonly string[], source: Listing | null, destination: Listing | null): string[] {
  if (!source || !destination) throw new Error("Load both filesystem panes first");
  if (!names.length || names.length > 50 || new Set(names).size !== names.length) {
    throw new Error("Choose 1–50 distinct files");
  }
  const output: string[] = [];
  for (const name of names) {
    if (!portableName(name)) throw new Error("Unsupported filename");
    const item = source.entries.find(entry => entry.name === name);
    if (!item || item.kind !== "file") throw new Error(`Not a regular file: ${name}`);
    if (destination.entries.some(entry => entry.name === name)) {
      throw new Error(`Destination already contains: ${name}; overwrite is disabled`);
    }
    output.push(name);
  }
  return output;
}

/** Ephemeral transfer report. No credentials or session identifiers. */
export type BatchItemState = "queued" | "active" | "done" | "failed" | "cancelled" | "skipped" | "paused";
export type BatchItem = { name: string; state: BatchItemState };
export function startBatch(names: readonly string[]): BatchItem[] {
  return names.map(name => ({name, state:"queued"}));
}
export function updateBatchItem(items: readonly BatchItem[], index: number, state: BatchItemState): BatchItem[] {
  if (index < 0 || index >= items.length) return [...items];
  return items.map((item,i) => i === index ? {...item,state} : item);
}
export function finishBatch(items: readonly BatchItem[]): BatchItem[] {
  // The active item should only be left active if the frontend was interrupted
  // before a backend result; a conservative incomplete status is safest.
  return items.map(item => item.state === "queued" ? {...item,state:"skipped"}
    : item.state === "active" ? {...item,state:"cancelled"} : item);
}

/** Explicit, ephemeral queue retry. Never retry files already marked done.
 * The caller must supply freshly reloaded panes from the same connection and
 * keep every destination conflict check in the real SFTP backend.
 */
export function remainingBatchIndexes(items: readonly BatchItem[]): number[] {
  return items.flatMap((item,index)=>
    item.state==="failed" || item.state==="cancelled" || item.state==="skipped"
      ? [index] : []);
}
export function retryBatchPlan(
  originalNames: readonly string[],
  items: readonly BatchItem[],
  source: Listing | null,
  destination: Listing | null,
  sourceSnapshot: readonly FileEntry[]
): {indexes:number[];names:string[]} {
  if(items.length!==originalNames.length || sourceSnapshot.length!==originalNames.length
    || !items.every((item,index)=>item.name===originalNames[index]
      && sourceSnapshot[index].name===originalNames[index])) {
    throw new Error("Transfer report does not match the original queue");
  }
  const indexes=remainingBatchIndexes(items);
  if(!indexes.length)throw new Error("No incomplete files to retry");
  if(!source || !destination)throw new Error("Refresh both filesystem panes before retry");
  const names=indexes.map(index=>originalNames[index]);
  const checked=transferBatchPlan(names,source,destination);
  for(const index of indexes){
    const original=sourceSnapshot[index];
    const updated=source.entries.find(entry=>entry.name===original.name);
    if(!updated || updated.kind!==original.kind || updated.size!==original.size
      || updated.modified!==original.modified || updated.permissions!==original.permissions){
      throw new Error(`Source metadata changed: ${original.name}; create a new transfer plan`);
    }
  }
  return {indexes,names:checked};
}
