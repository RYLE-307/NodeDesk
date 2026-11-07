import test from "node:test";
import assert from "node:assert/strict";
import { portableName, childPath, parentPath, transferAllowed, progressPercent, visibleEntries, transferBatchPlan, startBatch, updateBatchItem, finishBatch, remainingBatchIndexes, retryBatchPlan, OperationGate } from "../src/filesModel.ts";

test("reject traversal, Windows devices, alternate streams and control characters", () => {
  for (const name of ["", ".", "..", "a/b", "a\\b", "x:y", "NUL.txt", "COM1", "CONOUT$", "file.", "x\n", "\x1b[31m", "x*"]) {
    assert.equal(portableName(name),false,name);
    assert.throws(() => childPath("/tmp",name,true));
  }
  assert.equal(portableName("бинарный файл ;$(x).bin"),true);
  assert.equal(portableName("я".repeat(128)),false);
});
test("local Windows and remote POSIX paths remain separate, including roots", () => {
  assert.equal(childPath("/home/user","a.bin",true),"/home/user/a.bin");
  assert.equal(childPath("C:\\Users\\user","a.bin",false),"C:\\Users\\user\\a.bin");
  assert.equal(parentPath("/home/user",true),"/home");
  assert.equal(parentPath("/",true),"/");
  assert.equal(parentPath("C:\\",false),"C:\\");
  assert.equal(parentPath("C:\\Users",false),"C:\\");
});
test("transfers need both loaded paths, regular file and idle state", () => {
  const panel={path:"/tmp",entries:[]}, file={name:"file",kind:"file"};
  assert.equal(transferAllowed(file,panel,panel,false),true);
  for (const kind of ["symlink","directory","other"]) assert.equal(transferAllowed({...file,kind},panel,panel,false),false);
  assert.equal(transferAllowed(file,panel,null,false),false);
  assert.equal(transferAllowed(file,panel,panel,true),false);
  assert.equal(transferAllowed({...file,name:"../x"},panel,panel,false),false);
});
test("progress handles unknown, empty and changed sizes", () => {
  assert.equal(progressPercent({bytes:0,total:null}),undefined);
  assert.equal(progressPercent({bytes:0,total:0}),undefined);
  assert.equal(progressPercent({bytes:50,total:100}),50);
  assert.equal(progressPercent({bytes:200,total:100}),100);
});
test("request gate prevents double clicks and ignores stale completion after cancellation", () => {
  const gate = new OperationGate();
  assert.equal(gate.begin("a"),true); assert.equal(gate.begin("b"),false);
  assert.equal(gate.finish("old"),false); assert.equal(gate.owns("a"),true);
  assert.equal(gate.finish("a"),true); assert.equal(gate.begin("b"),true);
  assert.equal(gate.owns("a"),false); assert.equal(gate.finish("a"),false);
});

test("directory-first view and localized filename search preserve the source listing", () => {
  const entries=[
    {name:"file10.txt",kind:"file"},
    {name:"файл Б.txt",kind:"file"},
    {name:"z-dir",kind:"directory"},
    {name:"file2.txt",kind:"file"},
    {name:"a-dir",kind:"directory"},
    {name:"SYMLINK",kind:"symlink"},
  ];
  const snapshot=entries.map(e=>e.name);
  const sorted=visibleEntries(entries,"").map(e=>e.name);
  assert.deepEqual(sorted.slice(0,2),["a-dir","z-dir"]);
  assert.ok(sorted.indexOf("file2.txt")<sorted.indexOf("file10.txt"),"numeric name sorting");
  assert.equal(sorted.length,entries.length);
  assert.deepEqual(visibleEntries(entries,"ФАЙЛ").map(e=>e.name),["файл Б.txt"]);
  assert.deepEqual(visibleEntries(entries,"  DIR ").map(e=>e.name),["a-dir","z-dir"]);
  assert.deepEqual(entries.map(e=>e.name),snapshot,"sorting must not mutate authoritative state");
});

test("bounded multi-file transfer plan rejects entire unsafe batches", () => {
  const local={path:"/source",entries:[
    {name:"a.bin",kind:"file"},{name:"b.bin",kind:"file"},
    {name:"dir",kind:"directory"},{name:"link",kind:"symlink"},
    {name:"bad/name",kind:"file"},
  ]};
  const remote={path:"/remote",entries:[]};
  assert.deepEqual(transferBatchPlan(["a.bin","b.bin"],local,remote),["a.bin","b.bin"]);
  assert.deepEqual(local.entries.map(e=>e.name),["a.bin","b.bin","dir","link","bad/name"]);
  for (const names of [
    [],["a.bin","a.bin"],["a.bin","missing"],["dir"],["link"],
    ["bad/name"],Array.from({length:51},()=> "a.bin"),
  ]) assert.throws(()=>transferBatchPlan(names,local,remote));
  assert.throws(()=>transferBatchPlan(["a.bin","b.bin"],local,
    {...remote,entries:[{name:"b.bin",kind:"file"}]}),/overwrite/);
  assert.throws(()=>transferBatchPlan(["a.bin"],null,remote),/Load both/);
});

test("ephemeral transfer report classifies completed, failed and not-started items",()=>{
  const names=["a.bin","b.bin","c.bin"];
  const original=startBatch(names);
  assert.deepEqual(original.map(item=>item.state),["queued","queued","queued"]);
  const first=updateBatchItem(original,0,"active");
  const done=updateBatchItem(first,0,"done");
  const second=updateBatchItem(done,1,"failed");
  const finished=finishBatch(second);
  assert.deepEqual(finished.map(item=>item.state),["done","failed","skipped"]);
  assert.deepEqual(original.map(item=>item.state),["queued","queued","queued"],"immutable history");
  assert.equal(updateBatchItem(done,-1,"done").length,3);
  assert.equal(updateBatchItem(done,999,"done").length,3);
  assert.deepEqual(finishBatch(updateBatchItem(done,1,"active")).map(item=>item.state),["done","cancelled","skipped"]);
});


test("retry queue includes only incomplete items and validates refreshed source metadata",()=>{
  const snapshots=[
    {name:"a.bin",kind:"file",size:10,modified:123,permissions:384},
    {name:"b.bin",kind:"file",size:20,modified:124,permissions:384},
    {name:"c.bin",kind:"file",size:30,modified:125,permissions:384},
  ];
  const names=snapshots.map(file=>file.name);
  const report=finishBatch([
    {name:"a.bin",state:"done"},{name:"b.bin",state:"failed"},{name:"c.bin",state:"queued"}
  ]);
  const source={path:"/local",entries:snapshots};
  const destination={path:"/remote",entries:[snapshots[0]]};
  assert.deepEqual(remainingBatchIndexes(report),[1,2]);
  assert.deepEqual(retryBatchPlan(names,report,source,destination,snapshots),
    {indexes:[1,2],names:["b.bin","c.bin"]});
  assert.throws(()=>retryBatchPlan(names,report,null,destination,snapshots),/Refresh/);
  assert.throws(()=>retryBatchPlan(names,report,source,
    {...destination,entries:[snapshots[0],snapshots[1]]},snapshots),/overwrite/);
  assert.throws(()=>retryBatchPlan(names,report,
    {...source,entries:[snapshots[0],{...snapshots[1],size:25},snapshots[2]]},
    destination,snapshots),/metadata changed/);
  assert.throws(()=>retryBatchPlan(names,[{name:"other",state:"failed"},...report.slice(1)],
    source,destination,snapshots),/does not match/);
  assert.throws(()=>retryBatchPlan(names,names.map(name=>({name,state:"done"})),
    source,destination,snapshots),/No incomplete/);
  assert.deepEqual(remainingBatchIndexes([{name:"a",state:"done"},
    {name:"b",state:"cancelled"},{name:"c",state:"skipped"}]),[1,2]);
  assert.deepEqual(remainingBatchIndexes([{name:"a",state:"done"},
    {name:"b",state:"paused"}]),[1]);
});
