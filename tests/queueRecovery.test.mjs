import test from "node:test";
import assert from "node:assert/strict";
import {RECOVERY_KEY, validateRecovery, loadRecovery, listRecoveries, saveRecovery,
  forgetRecovery} from "../src/queueRecovery.ts";

const now=Date.UTC(2026,10,7,19,0,0);
const endpoint={host:"example.internal",port:2222,username:"operator"};
const fakeStorage=()=> {
  const map=new Map();
  return {
    getItem:key=>map.get(key)??null,
    setItem:(key,value)=>map.set(key,value),
    removeItem:key=>map.delete(key)
  };
};
function record(overrides={}){
  return {
    version:1,endpoint,upload:false,localDirectory:"/safe/local",
    remoteDirectory:"/safe/remote",names:["done.bin","part.bin"],
    sourceEntries:[
      {name:"done.bin",kind:"file",size:100,modified:2,permissions:384},
      {name:"part.bin",kind:"file",size:200,modified:3,permissions:384}
    ],
    items:[{name:"done.bin",state:"done"},{name:"part.bin",state:"active"}],
    partial:{index:1,previousId:"12345678-1234-4234-8234-123456789abc"},
    savedAt:now,...overrides
  };
}
test("opt-in checkpoint restores incomplete entries but never resumes operations automatically",()=>{
  const store=fakeStorage();
  assert.equal(loadRecovery(store,endpoint,now),null);
  assert.equal(saveRecovery(store,record(),now),true);
  const restored=loadRecovery(store,endpoint,now);
  assert.deepEqual(restored.items,[
    {name:"done.bin",state:"done"},{name:"part.bin",state:"cancelled"}
  ]);
  assert.equal(restored.partial.previousId,"12345678-1234-4234-8234-123456789abc");
  assert.equal(loadRecovery(store,{...endpoint,host:"other.internal"},now),null);
  const raw=store.getItem(RECOVERY_KEY);
  assert.equal(raw.includes("authSession"),false);
  assert.equal(raw.includes("password"),false);
  assert.equal(raw.includes("privateKey"),false);
});
test("validation fails closed on tampered paths, filenames, states, IDs and metadata",()=>{
  const invalids=[
    record({names:["../outside","part.bin"]}),
    record({endpoint:{...endpoint,port:70000}}),
    record({sourceEntries:[{name:"done.bin",kind:"symlink",size:100,modified:2,permissions:384},
      {name:"part.bin",kind:"file",size:200,modified:3,permissions:384}]}),
    record({items:[{name:"done.bin",state:"done"},{name:"part.bin",state:"done"}]}),
    record({items:[{name:"done.bin",state:"done"},{name:"part.bin",state:"evil"}]}),
    record({partial:{index:0,previousId:"12345678-1234-4234-8234-123456789abc"}}),
    record({partial:{index:1,previousId:"../../malicious"}}),
    record({names:["done.bin","done.bin"]}),
    record({localDirectory:"/bad\npath"}),
    record({savedAt:now-8*24*60*60*1000})
  ];
  for(const item of invalids)assert.equal(validateRecovery(item,now),null);
  const store=fakeStorage();
  store.setItem(RECOVERY_KEY,"{invalid");
  assert.equal(loadRecovery(store,endpoint,now),null);
});
test("store refuses a ninth checkpoint without silently evicting unfinished work",()=>{
  const store=fakeStorage();
  for(let i=0;i<10;i++){
    assert.equal(saveRecovery(store,record({
      endpoint:{...endpoint,host:"server"+i+".internal"},savedAt:now+i
    }),now+100),i<8);
  }
  const saved=JSON.parse(store.getItem(RECOVERY_KEY));
  assert.equal(saved.records.length,8);
  assert.ok(loadRecovery(store,{...endpoint,host:"server0.internal"},now+100));
  assert.equal(loadRecovery(store,{...endpoint,host:"server9.internal"},now+100),null);
  forgetRecovery(store,{...endpoint,host:"server0.internal"});
  assert.equal(loadRecovery(store,{...endpoint,host:"server0.internal"},now+100),null);
  assert.ok(loadRecovery(store,{...endpoint,host:"server1.internal"},now+100));
});
test("recovery never accepts an all-done queue or stale expired metadata",()=>{
  const store=fakeStorage();
  assert.equal(saveRecovery(store,record({items:[
    {name:"done.bin",state:"done"},{name:"part.bin",state:"done"}
  ],partial:null}),now),false);
  assert.equal(saveRecovery(store,record(),now),true);
  assert.equal(loadRecovery(store,endpoint,now+8*24*60*60*1000),null);
});
test("a paused item remains incomplete after restart",()=>{
  const store=fakeStorage();
  assert.equal(saveRecovery(store,record({items:[
    {name:"done.bin",state:"done"},{name:"part.bin",state:"paused"}
  ]}),now),true);
  assert.deepEqual(loadRecovery(store,endpoint,now).items.map(item=>item.state),
    ["done","paused"]);
});
test("separate queue checkpoints on one endpoint are independently restored and forgotten",()=>{
  const store=fakeStorage();
  const first="11111111-1111-4111-8111-111111111111";
  const second="22222222-2222-4222-8222-222222222222";
  assert.equal(saveRecovery(store,record({queueId:first}),now),true);
  assert.equal(saveRecovery(store,record({queueId:second,names:["done.bin","other.bin"],
    sourceEntries:[{name:"done.bin",kind:"file",size:100,modified:2,permissions:384},
      {name:"other.bin",kind:"file",size:200,modified:3,permissions:384}],
    items:[{name:"done.bin",state:"done"},{name:"other.bin",state:"paused"}]}),now),true);
  assert.deepEqual(listRecoveries(store,endpoint,now).map(item=>item.queueId),[second,first]);
  forgetRecovery(store,endpoint,first);
  assert.deepEqual(listRecoveries(store,endpoint,now).map(item=>item.queueId),[second]);
  assert.equal(saveRecovery(store,record({queueId:"bad-id"}),now),false);
});
