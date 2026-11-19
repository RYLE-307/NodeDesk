import test from "node:test";
import assert from "node:assert/strict";
import { parseMobaSessions } from "../src/mobaImport.ts";

test("MobaXterm parser imports SSH/RDP/VNC endpoints and nested folders only",()=>{
  const contents=[
    "[Bookmarks]","SubRep=","ImgNum=42",
    "Primary SSH=#109#0%ssh.example.org%22%<default>%%0%0%ignored-secret",
    "[Bookmarks_3]","SubRep=Customers\\Servers","ImgNum=41",
    "Remote Desktop=#91#4%rdp.example.org%3390%admin%0%0",
    "Remote VNC=#128#5%vnc.example.org%5901%-1%0",
    "Legacy=#98#1%legacy.example.org%23%admin",
  ].join("\r\n");
  const parsed=parseMobaSessions(contents);
  assert.equal(parsed.imported,3);
  assert.equal(parsed.skipped,1);
  assert.deepEqual(parsed.catalog.groups.map(g=>g.name),["Customers","Servers"]);
  assert.equal(parsed.catalog.groups[1].parentId,parsed.catalog.groups[0].id);
  assert.deepEqual(parsed.catalog.connections.map(c=>[c.protocol,c.host,c.port,c.username]),[
    ["SSH","ssh.example.org",22,""],
    ["RDP","rdp.example.org",3390,"admin"],
    ["VNC","vnc.example.org",5901,""],
  ]);
  assert.equal(parsed.catalog.connections[1].groupId,parsed.catalog.groups[1].id);
  assert.equal(parsed.catalog.connections[2].groupId,parsed.catalog.groups[1].id);
  assert.ok(!JSON.stringify(parsed.catalog).includes("ignored-secret"));
});

test("MobaXterm parser fails closed on malformed, dangerous or unsupported exports",()=>{
  for(const raw of [
    "", "[Other]\\nValue=foo",
    "[Bookmarks]\\nOnlyTelnet=#98#1%legacy.example%23",
    "[Bookmarks]\\nBadPort=#109#0%host%0%user",
    "[Bookmarks]\\nBadHost=#109#0%ssh://evil%22%user",
    "[Bookmarks]\\nBadName\x01=#109#0%host%22%user",
    "[Bookmarks]\\nSubRep=Bad\x01\\nS=#109#0%host%22%user",
  ]) assert.throws(()=>parseMobaSessions(raw.replaceAll("\\n","\n")));
  const valid=parseMobaSessions("[Bookmarks]\\nOK=#109#0%host.example%22%operator".replaceAll("\\n","\n"));
  assert.equal(valid.imported,1);
  assert.deepEqual(Object.keys(valid.catalog.connections[0]).sort(),
    ["favorite","groupId","host","id","name","port","protocol","username"].sort());
});
