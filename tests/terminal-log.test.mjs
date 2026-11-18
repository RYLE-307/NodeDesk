import test from "node:test";
import assert from "node:assert/strict";
import {
  collectTerminalScrollback,
  MAX_TERMINAL_LOG_BYTES,
  MAX_TERMINAL_LOG_LINES,
} from "../src/terminalLog.ts";

const line=(text, isWrapped=false)=>({
  isWrapped, translateToString(trimRight=false) {
    return trimRight ? text.replace(/\s+$/u,"") : text;
  },
});
const buffer=(items)=>({length:items.length,getLine(index){return items[index];}});

test("terminal log exports displayed text with soft-wrapped lines joined",()=>{
  const result=collectTerminalScrollback(buffer([
    line("admin@host:~$ ls"),
    line("file-with-a-long-",false),
    line("name.txt",true),
    line("привет"),
  ]));
  assert.deepEqual(result,{
    text:"admin@host:~$ ls\nfile-with-a-long-name.txt\nпривет",
    truncated:false,
  });
});
test("terminal log returns empty for a fresh terminal and never auto-creates data",()=>{
  assert.deepEqual(collectTerminalScrollback(buffer([line("")])),{text:"",truncated:false});
  assert.deepEqual(collectTerminalScrollback(buffer([])),{text:"",truncated:false});
});
test("terminal log caps UTF-8 bytes without slicing through multibyte characters",()=>{
  const oversized=collectTerminalScrollback(buffer([
    line("🙂".repeat(MAX_TERMINAL_LOG_BYTES/4)),
    line("private-fragment"),
  ]));
  assert.equal(new TextEncoder().encode(oversized.text).length,MAX_TERMINAL_LOG_BYTES);
  assert.equal(oversized.truncated,true);
  assert.ok(!oversized.text.includes("private-fragment"));
  const rejected=collectTerminalScrollback(buffer([line("🙂".repeat(MAX_TERMINAL_LOG_BYTES/4+1))]));
  assert.equal(rejected.text,"");
  assert.equal(rejected.truncated,true);
});
test("terminal log bounds line scans and rejects corrupt length",()=>{
  const long=collectTerminalScrollback({
    length:MAX_TERMINAL_LOG_LINES+10,
    getLine(index){return line(String(index));}
  });
  assert.equal(long.truncated,true);
  assert.ok(long.text.startsWith("0\n1\n"));
  assert.ok(!long.text.includes(String(MAX_TERMINAL_LOG_LINES+1)));
  assert.throws(()=>collectTerminalScrollback({length:-1,getLine(){return undefined;}}));
  assert.throws(()=>collectTerminalScrollback({length:Infinity,getLine(){return undefined;}}));
});
