import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decode,
  descendants,
  emptyCatalog,
  KEY,
  load,
  removeGroup,
  save,
} from "../src/catalog.ts";
const fixture = () => ({
  ...emptyCatalog(),
  groups: [
    { id: "a", name: "Parent", parentId: null },
    { id: "b", name: "Child", parentId: "a" },
  ],
  connections: [
    {
      id: "c",
      name: "Server",
      host: "::1",
      port: 22,
      username: "admin",
      protocol: "SSH",
      groupId: "b",
      favorite: true,
    },
  ],
});
test("round trip retains nested catalog and preferences", () => {
  const memory = new Map();
  const storage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
  };
  const data = {
    ...fixture(),
    language: "en",
    theme: "system",
    monitoring: true,
  };
  assert.deepEqual(load(storage), emptyCatalog());
  save(storage, data);
  assert.deepEqual(load(storage), data);
  assert.equal(JSON.parse(memory.get(KEY)).version, 1);
});
test("rejects corrupt, future, cyclic and dangling data", () => {
  for (const raw of [
    "{",
    "null",
    JSON.stringify({ ...fixture(), version: 2 }),
    JSON.stringify({
      ...fixture(),
      groups: [
        { id: "a", name: "A", parentId: "b" },
        { id: "b", name: "B", parentId: "a" },
      ],
    }),
    JSON.stringify({ ...fixture(), groups: [] }),
  ])
    assert.throws(() => decode(raw));
});
test("rejects duplicate IDs, invalid ports and URL credentials", () => {
  for (const changes of [
    { port: 0 },
    { port: 65536 },
    { port: 1.5 },
    { host: "ssh://user:secret@host" },
    { id: "a" },
    { name: " " },
  ]) {
    const d = fixture();
    Object.assign(d.connections[0], changes);
    assert.throws(() => decode(JSON.stringify(d)));
  }
});
test("allowlist discards unknown secret fields", () => {
  const d = fixture();
  d.connections[0].password = "sensitive";
  d.token = "sensitive";
  assert.ok(!JSON.stringify(decode(JSON.stringify(d))).includes("sensitive"));
});
test("deleting subtree preserves connections at root", () => {
  const d = fixture();
  assert.deepEqual([...descendants(d.groups, "a")], ["a", "b"]);
  const next = removeGroup(d, "a");
  assert.equal(next.groups.length, 0);
  assert.equal(next.connections[0].groupId, null);
  assert.equal(d.connections[0].groupId, "b");
});
test("storage failures propagate without overwriting corrupt source", () => {
  let writes = 0;
  const storage = {
    getItem: () => "{broken",
    setItem: () => {
      writes++;
      throw Error("quota");
    },
  };
  assert.throws(() => load(storage));
  assert.equal(writes, 0);
  assert.throws(() => save(storage, fixture()));
  assert.equal(writes, 1);
});
