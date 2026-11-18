import test from "node:test";
import assert from "node:assert/strict";
import {planCatalogNetworkBatch,MAX_NETWORK_BATCH} from "../src/networkBatch.ts";
const fixtures=()=>[
  {id:"a",name:"SSH fixture",host:"ssh.example.test",port:22,username:"root",
    protocol:"SSH",groupId:null,favorite:false,password:"never-include"},
  {id:"b",name:"RDP fixture",host:"rdp.example.test",port:3389,username:"user",
    protocol:"RDP",groupId:null,favorite:false,rdpSha256Fingerprint:"a".repeat(64)},
  {id:"c",name:"VNC fixture",host:"vnc.example.test",port:5900,username:"",
    protocol:"VNC",groupId:null,favorite:false},
];
test("batch network plan is ordered, capped and allowlists only public endpoint data",()=>{
  const input=fixtures();
  const result=planCatalogNetworkBatch(input,["b","a"]);
  assert.deepEqual(result,[
    {id:"a",name:"SSH fixture",host:"ssh.example.test",port:22,protocol:"SSH"},
    {id:"b",name:"RDP fixture",host:"rdp.example.test",port:3389,protocol:"RDP"},
  ]);
  assert.ok(!JSON.stringify(result).includes("never-include"));
  assert.ok(!JSON.stringify(result).includes("a".repeat(64)));
  assert.ok(!JSON.stringify(result).includes("username"));
});
test("batch network plan rejects malformed, duplicated and stale target selection",()=>{
  const input=fixtures();
  for(const selection of [[],["a","a"],["missing"],["a","missing"],
    Array.from({length:MAX_NETWORK_BATCH+1},(_,i)=>"id-"+i)]){
    assert.throws(()=>planCatalogNetworkBatch(input,selection));
  }
  for(const overrides of [
    {host:"-oProxyCommand=bad"},{host:"https://example.test"},
    {port:0},{port:65536},{port:22.5},{protocol:"TELNET"},
  ]){
    assert.throws(()=>planCatalogNetworkBatch([{...input[0],...overrides}],["a"]));
  }
});
