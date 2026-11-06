import test from "node:test";
import assert from "node:assert/strict";
import { portableName, childPath, parentPath, transferAllowed, progressPercent, OperationGate } from "../src/filesModel.ts";

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
