import test from "node:test";
import assert from "node:assert/strict";
import {emptyCatalog,decode,mergeCatalog} from "../src/catalog.ts";
import {exportSelectedCatalog} from "../src/catalogSelectionExport.ts";
import {MAX_BULK_CONNECTIONS} from "../src/catalogBulk.ts";

const fixture=()=>({
  ...emptyCatalog(),language:"ru",theme:"light",
  groups:[
    {id:"root",name:"Customers",parentId:null},
    {id:"child",name:"Production",parentId:"root"},
    {id:"other",name:"Unrelated",parentId:null},
  ],
  connections:[
    {id:"ssh",name:"SSH",host:"ssh.example.test",port:22,username:"ops",protocol:"SSH",groupId:null,favorite:true,password:"fixture-no-export"},
    {id:"rdp",name:"RDP",host:"rdp.example.test",port:3389,username:"ops",protocol:"RDP",groupId:"child",favorite:false,
      rdpSha256Fingerprint:"a".repeat(64)},
    {id:"vnc",name:"VNC",host:"vnc.example.test",port:5900,username:"",protocol:"VNC",groupId:"other",favorite:false},
  ],
});
test("selected export includes only chosen endpoints and their full ancestor path",()=>{
  const existing=fixture();
  const original=JSON.stringify(existing);
  const ids=["new-root","new-child","new-ssh","new-rdp"];
  const output=exportSelectedCatalog(existing,["rdp","ssh"],()=>ids.shift());
  assert.deepEqual(output.connections.map(c=>c.name),["SSH","RDP"]);
  assert.deepEqual(output.groups.map(g=>g.name),["Customers","Production"]);
  assert.equal(output.groups[1].parentId,"new-root");
  assert.equal(output.connections[1].groupId,"new-child");
  assert.equal(output.connections[0].groupId,null);
  assert.equal(output.connections[0].favorite,true);
  assert.ok(!JSON.stringify(output).includes("fixture-no-export"));
  assert.ok(!JSON.stringify(output).includes("a".repeat(64)));
  assert.equal(output.connections[0].id,"new-ssh");
  assert.equal(output.connections[1].id,"new-rdp");
  assert.equal(output.language,emptyCatalog().language);
  assert.equal(output.theme,"dark");
  assert.equal(JSON.stringify(existing),original);
  assert.deepEqual(decode(JSON.stringify(output)),output);
});
test("exported IDs do not reuse Vault identity, including after catalog replacement",()=>{
  const current=fixture();
  const exported=exportSelectedCatalog(current,["rdp"],(()=>{let n=0;return ()=>"share-"+(++n);})());
  assert.equal(exported.connections[0].id,"share-3");
  assert.ok(!current.connections.some(c=>c.id===exported.connections[0].id));
  const merged=mergeCatalog(current,exported,(()=>{let n=0;return ()=>"import-"+(++n);})());
  assert.equal(merged.connections.length,4);
  assert.equal(merged.connections[3].rdpSha256Fingerprint,undefined);
  assert.notEqual(merged.connections[3].id,exported.connections[0].id);
});
test("stale, duplicate or excessive selection and generated collisions reject atomically",()=>{
  const source=fixture();
  const original=JSON.stringify(source);
  for(const ids of [[],["missing"],["ssh","ssh"],["ssh","missing"],
    Array.from({length:MAX_BULK_CONNECTIONS+1},()=>"ssh")]){
    assert.throws(()=>exportSelectedCatalog(source,ids));
  }
  assert.throws(()=>exportSelectedCatalog(source,["rdp"],()=>"root"));
  assert.throws(()=>exportSelectedCatalog(source,["rdp"],()=>"same"));
  assert.equal(JSON.stringify(source),original);
});
