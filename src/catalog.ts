export type Group = { id: string; name: string; parentId: string | null };
export type Connection = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  protocol: "SSH" | "RDP";
  groupId: string | null;
  favorite: boolean;
};
export type Catalog = {
  version: 1;
  groups: Group[];
  connections: Connection[];
  language: "ru" | "en";
  theme: "dark" | "light" | "system";
  monitoring: boolean;
};
export const KEY = "nodedesk.catalog.v1";
export const emptyCatalog = (): Catalog => ({
  version: 1,
  groups: [],
  connections: [],
  language: "ru",
  theme: "dark",
  monitoring: false,
});
const text = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.length <= max && !/[\u0000-\u001f]/.test(v);
export function descendants(groups: Group[], id: string): Set<string> {
  const result = new Set([id]);
  let size = 0;
  while (size !== result.size) {
    size = result.size;
    groups.forEach((g) => {
      if (g.parentId && result.has(g.parentId)) result.add(g.id);
    });
  }
  return result;
}
export function decode(raw: string): Catalog {
  if (raw.length > 2_000_000) throw new Error("invalid");
  const v = JSON.parse(raw);
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.groups) ||
    !Array.isArray(v.connections) ||
    v.groups.length > 1000 ||
    v.connections.length > 10000
  )
    throw new Error("invalid");
  const ids = new Set<string>();
  for (const item of [...v.groups, ...v.connections]) {
    if (
      !item ||
      !text(item.id) ||
      !item.id ||
      ids.has(item.id) ||
      !text(item.name) ||
      !item.name.trim()
    )
      throw new Error("invalid");
    ids.add(item.id);
  }
  const groupIds = new Set(v.groups.map((g: Group) => g.id));
  for (const g of v.groups) {
    if (g.parentId !== null && !groupIds.has(g.parentId))
      throw new Error("invalid");
    const visited = new Set([g.id]);
    let parent = g.parentId;
    while (parent !== null) {
      if (visited.has(parent)) throw new Error("invalid");
      visited.add(parent);
      parent = v.groups.find((x: Group) => x.id === parent).parentId;
    }
  }
  for (const c of v.connections)
    if (
      !text(c.host, 253) ||
      !c.host ||
      /[\s/@?#\\]/.test(c.host) ||
      !text(c.username) ||
      !["SSH", "RDP"].includes(c.protocol) ||
      !Number.isInteger(c.port) ||
      c.port < 1 ||
      c.port > 65535 ||
      typeof c.favorite !== "boolean" ||
      (c.groupId !== null && !groupIds.has(c.groupId))
    )
      throw new Error("invalid");
  if (
    !["ru", "en"].includes(v.language) ||
    !["dark", "light", "system"].includes(v.theme) ||
    typeof v.monitoring !== "boolean"
  )
    throw new Error("invalid");
  // Explicit allowlist: never persist unknown properties (passwords, tokens, etc.).
  return {
    version: 1,
    groups: v.groups.map((g: Group) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId,
    })),
    connections: v.connections.map((c: Connection) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username,
      protocol: c.protocol,
      groupId: c.groupId,
      favorite: c.favorite,
    })),
    language: v.language,
    theme: v.theme,
    monitoring: v.monitoring,
  };
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function load(storage: StorageLike): Catalog {
  const raw = storage.getItem(KEY);
  return raw === null ? emptyCatalog() : decode(raw);
}
export function save(storage: StorageLike, data: Catalog) {
  storage.setItem(KEY, JSON.stringify(decode(JSON.stringify(data))));
}
export function removeGroup(data: Catalog, id: string): Catalog {
  const removed = descendants(data.groups, id);
  return {
    ...data,
    groups: data.groups.filter((g) => !removed.has(g.id)),
    connections: data.connections.map((c) =>
      removed.has(c.groupId ?? "") ? { ...c, groupId: null } : c,
    ),
  };
}

export function moveConnection(data: Catalog, id: string, groupId: string | null): Catalog {
  if (!data.connections.some(c => c.id === id) ||
      (groupId !== null && !data.groups.some(g => g.id === groupId))) return data;
  if (data.connections.find(c => c.id === id)!.groupId === groupId) return data;
  return { ...data, connections: data.connections.map(c => c.id === id ? { ...c, groupId } : c) };
}
