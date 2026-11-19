import { decode, emptyCatalog } from "./catalog.ts";
import type { Catalog, Connection, Group } from "./catalog.ts";

/** Conservative MobaXterm bookmark importer. Import only plain endpoint data.
 * Never execute embedded commands or copy passwords, paths, proxy settings,
 * authentication options, private-key references or RDP/VNC redirections.
 */
export type MobaImportResult = {
  catalog: Catalog;
  imported: number;
  skipped: number;
};
type Section = { folder: string; entries: Array<{ name: string; value: string }> };
const safeLabel = (value: string, max: number) =>
  value.length > 0 && value.length <= max &&
  !/[\x00-\x1f\x7f]/u.test(value);
const safeHost = (value: string) =>
  safeLabel(value, 253) && !/[\s/@?#\\]/u.test(value);
const isPort = (value: string) => /^\d{1,5}$/.test(value) &&
  Number(value) > 0 && Number(value) <= 65535;

export function parseMobaSessions(raw: string): MobaImportResult {
  if (raw.length > 2_000_000 || raw.includes("\0"))
    throw new Error("invalid MobaXterm export");
  const sections: Section[] = [];
  let active: Section | null = null;
  for (const sourceLine of raw.split(/\r?\n/u)) {
    if (sourceLine.length > 16_384)
      throw new Error("oversized MobaXterm line");
    const line = sourceLine.trim();
    if (!line || line.startsWith(";")) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      if (/^\[Bookmarks(?:_\d+)?\]$/.test(line)) {
        active = { folder: "", entries: [] };
        sections.push(active);
      } else active = null;
      continue;
    }
    if (!active) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name === "SubRep") {
      active.folder = value;
    } else if (name !== "ImgNum") {
      active.entries.push({ name, value });
    }
  }
  if (!sections.length) throw new Error("not a MobaXterm bookmarks export");

  const groups: Group[] = [];
  const connections: Connection[] = [];
  const groupPaths = new Map<string, string>();
  let skipped = 0;
  function ensureFolder(folder: string): string | null {
    if (!folder) return null;
    const parts = folder.split("\\");
    if (parts.length > 32 || parts.some(p => !safeLabel(p.trim(), 200)))
      throw new Error("invalid MobaXterm folder path");
    let path = "";
    let parentId: string | null = null;
    for (const item of parts) {
      const name = item.trim();
      path += (path ? "\\" : "") + name;
      const existing = groupPaths.get(path);
      if (existing) { parentId = existing; continue; }
      if (groups.length >= 1000) throw new Error("too many groups");
      const id = `moba-group-${groups.length + 1}`;
      groups.push({ id, name, parentId });
      groupPaths.set(path, id);
      parentId = id;
    }
    return parentId;
  }

  for (const section of sections) {
    for (const item of section.entries) {
      const match = /^(?:;\s*logout)?\s*#\d{1,5}#([^#]{1,16384})/u.exec(item.value);
      if (!match || !safeLabel(item.name, 200)) { skipped++; continue; }
      const fields = match[1].split("%");
      const type = fields[0];
      const protocol: Connection["protocol"] | null =
        type === "0" ? "SSH" : type === "4" ? "RDP" :
        type === "5" ? "VNC" : null;
      const host = fields[1] ?? "";
      const port = fields[2] ?? "";
      const username = protocol === "VNC" ? "" :
        (fields[3] === "<default>" ? "" : fields[3] ?? "");
      if (!protocol || !safeHost(host) || !isPort(port) ||
          username.length > 200 || /[\x00-\x1f\x7f]/u.test(username)) {
        skipped++;
        continue;
      }
      const groupId = ensureFolder(section.folder);
      if (connections.length >= 10000)
        throw new Error("too many imported connections");
      connections.push({
        id: `moba-connection-${connections.length + 1}`,
        name: item.name, host, port: Number(port), username,
        protocol, groupId, favorite: false,
      });
    }
  }
  if (!connections.length) throw new Error("no supported sessions");
  const catalog = decode(JSON.stringify({
    ...emptyCatalog(), groups, connections,
  }));
  return { catalog, imported: connections.length, skipped };
}
