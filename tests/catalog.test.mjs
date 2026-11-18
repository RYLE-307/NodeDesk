import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decode,
  descendants,
  emptyCatalog,
  KEY,
  load,
  mergeCatalog,
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
test("RDP SHA256 pin normalizes and malformed or non-RDP pins fail",()=>{
  const d=fixture();
  d.connections[0].protocol="RDP";
  const pin="B3:FD:DF:E2:A1:35:B7:00:CD:0F:8D:A6:B7:15:FA:59:3E:5A:6F:56:7B:F5:C9:4F:C6:D0:10:32:03:D8:68:67";
  d.connections[0].rdpSha256Fingerprint=pin;
  const normalized=decode(JSON.stringify(d));
  assert.equal(normalized.connections[0].rdpSha256Fingerprint,pin.replaceAll(":","").toLowerCase());
  for(const bad of ["", "a".repeat(63), "g".repeat(64), "aa:bb", "/cert:ignore", "a:".repeat(32)]) {
    d.connections[0].rdpSha256Fingerprint=bad;
    assert.throws(()=>decode(JSON.stringify(d)));
  }
  d.connections[0].rdpSha256Fingerprint=pin;
  d.connections[0].protocol="SSH";
  assert.throws(()=>decode(JSON.stringify(d)));
});

test("VNC profiles retain v1 compatibility without persisting credentials",()=>{
  const data=fixture();
  data.connections[0].protocol="VNC";
  data.connections[0].port=5901;
  data.connections[0].username="";
  data.connections[0].password="never-store-this";
  const decoded=decode(JSON.stringify(data));
  assert.equal(decoded.version,1);
  assert.equal(decoded.connections[0].protocol,"VNC");
  assert.equal(decoded.connections[0].port,5901);
  assert.ok(!JSON.stringify(decoded).includes("never-store-this"));
  decoded.connections[0].protocol="NOT_A_PROTOCOL";
  assert.throws(()=>decode(JSON.stringify(decoded)));
});

test("catalog merge preserves originals and rekeys nested incoming IDs and secrets", () => {
  const existing=fixture();
  const incoming=fixture();
  incoming.connections[0].password="never-store-or-copy";
  incoming.groups.reverse();
  const ids=["fresh-parent","fresh-child","fresh-connection"];
  const merged=mergeCatalog(existing,incoming,()=>ids.shift());
  assert.equal(merged.groups.length,4);
  assert.equal(merged.connections.length,2);
  assert.deepEqual(merged.groups.slice(0,2),existing.groups);
  assert.deepEqual(merged.connections[0],existing.connections[0]);
  assert.deepEqual(merged.groups.slice(2),[
    {id:"fresh-child",name:"Child",parentId:"fresh-parent"},
    {id:"fresh-parent",name:"Parent",parentId:null},
  ]);
  assert.equal(merged.connections[1].id,"fresh-connection");
  assert.equal(merged.connections[1].groupId,"fresh-child");
  assert.equal(merged.language,existing.language);
  assert.equal(merged.theme,existing.theme);
  assert.ok(!JSON.stringify(merged).includes("never-store-or-copy"));
  assert.equal(incoming.connections[0].id,"c");
  assert.equal(existing.connections.length,1);
});

test("catalog merge rejects ID collisions and capacity overflow without mutating source", () => {
  const current=fixture();
  const incoming=fixture();
  const before=JSON.stringify(current);
  assert.throws(()=>mergeCatalog(current,incoming,()=>"c"));
  assert.throws(()=>mergeCatalog(current,incoming,()=>"same-id"));
  assert.equal(JSON.stringify(current),before);
  const full={...emptyCatalog(),connections:Array.from({length:10000},(_,i)=>({
    ...fixture().connections[0],id:`existing-${i}`
  }))};
  assert.throws(()=>mergeCatalog(full,incoming));
  assert.equal(full.connections.length,10000);
});
