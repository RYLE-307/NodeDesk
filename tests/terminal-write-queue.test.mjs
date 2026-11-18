import test from "node:test";
import assert from "node:assert/strict";
import {queueTerminalWrite} from "../src/terminalWriteQueue.ts";

function deferred() {
  let resolve,reject;
  const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
  return {promise,resolve,reject};
}
test("pending terminal input is discarded after disconnect or new session",async()=>{
  const gate=deferred();
  let current="old-session";
  const calls=[];
  const queued=queueTerminalWrite(gate.promise,"old-session","do-not-send",
    ()=>current,async(id,data)=>{calls.push({id,data});});
  current="new-session";
  gate.resolve();
  await queued;
  assert.deepEqual(calls,[]);
  await queueTerminalWrite(queued,"new-session","pwd",
    ()=>current,async(id,data)=>{calls.push({id,data});});
  assert.deepEqual(calls,[{id:"new-session",data:"pwd"}]);
});
test("PTY input remains ordered and exact while the session is unchanged",async()=>{
  let current="s1";
  const writes=[];
  let chain=Promise.resolve();
  chain=queueTerminalWrite(chain,"s1","password",
    ()=>current,async(id,data)=>{writes.push([id,data]);});
  chain=queueTerminalWrite(chain,"s1","\r",
    ()=>current,async(id,data)=>{writes.push([id,data]);});
  await chain;
  assert.deepEqual(writes,[["s1","password"],["s1","\r"]]);
  current=null;
  await queueTerminalWrite(chain,"s1","stale",()=>current,
    async()=>{throw Error("Must never write to disconnected session");});
});
test("failed previous input cannot poison a subsequent valid write",async()=>{
  let active="s2";
  const calls=[];
  const failed=queueTerminalWrite(Promise.resolve(),"s2","fail",
    ()=>active,async()=>{throw Error("synthetic transport failure");});
  await assert.rejects(failed);
  await queueTerminalWrite(failed,"s2","next",()=>active,
    async(id,data)=>{calls.push({id,data});});
  assert.deepEqual(calls,[{id:"s2",data:"next"}]);
});
