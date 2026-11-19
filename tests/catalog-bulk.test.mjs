import test from "node:test";
import assert from "node:assert/strict";
import {bulkUpdateConnections,MAX_BULK_CONNECTIONS} from "../src/catalogBulk.ts";
import {emptyCatalog,decode} from "../src/catalog.ts";
const original=()=>({
  ...emptyCatalog(),language:"en",
  groups:[{id:"operations",name:"Operations",parentId:null}],
  connections:[
    {id:"ssh",name:"SSH",host:"ssh.example.test",port:22,username:"ops",protocol:"SSH",groupId:null,favorite:false},
    {id:"rdp",name:"RDP",host:"rdp.example.test",port:3389,username:"ops",protocol:"RDP",groupId:null,favorite:false,
      rdpSha256Fingerprint:"a".repeat(64)},
    {id:"vnc",name:"VNC",host:"vnc.example.test",port:5900,username:"",protocol:"VNC",groupId:null,favorite:true},
  ],
});
test("bulk group move is all-or-nothing and preserves endpoint identity and RDP pin",()=>{
  const data=original();
  const before=JSON.stringify(data);
  const result=bulkUpdateConnections(data,["ssh","rdp"],{kind:"move",groupId:"operations"});
  assert.deepEqual(result.connections.map(c=>c.groupId),["operations","operations",null]);
  assert.equal(result.connections[1].rdpSha256Fingerprint,"a".repeat(64));
  assert.equal(result.connections[0].id,"ssh");
  assert.equal(result.connections[0].host,"ssh.example.test");
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(result.groups,data.groups);
});
test("favorite and unfavorite selected items without changing unrelated rows",()=>{
  const data=original();
  const marked=bulkUpdateConnections(data,["ssh","vnc"],{kind:"favorite",favorite:true});
  assert.deepEqual(marked.connections.map(c=>c.favorite),[true,false,true]);
  const unmarked=bulkUpdateConnections(marked,["ssh","vnc"],{kind:"favorite",favorite:false});
  assert.deepEqual(unmarked.connections.map(c=>c.favorite),[false,false,false]);
  assert.equal(bulkUpdateConnections(data,["vnc"],{kind:"favorite",favorite:true}),data);
});
test("bulk operation rejects stale, duplicate, invalid, excessive or unsafe actions",()=>{
  const data=original();
  const before=JSON.stringify(data);
  const bad=[
    {ids:[],action:{kind:"favorite",favorite:true}},
    {ids:["missing"],action:{kind:"favorite",favorite:true}},
    {ids:["ssh","ssh"],action:{kind:"favorite",favorite:true}},
    {ids:["ssh"],action:{kind:"favorite",favorite:"yes"}},
    {ids:["ssh"],action:{kind:"move",groupId:"missing"}},
    {ids:["ssh"],action:{kind:"move",groupId:undefined}},
    {ids:["ssh"],action:{kind:"delete"}},
    {ids:Array.from({length:MAX_BULK_CONNECTIONS+1},()=>"ssh"),action:{kind:"favorite",favorite:true}}
  ];
  for(const input of bad)assert.throws(()=>bulkUpdateConnections(data,input.ids,input.action));
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(decode(JSON.stringify(data)),data);
});
