import test from "node:test";
import assert from "node:assert/strict";
import {MAX_SNIPPET_BYTES,prepareTerminalSnippet} from "../src/terminalSnippet.ts";

test("snippet preserves exact manual input without adding Enter",()=>{
  for (const command of ["ls -la","df -h","echo 'привет'","printf 'hello' | wc -c"])
    assert.equal(prepareTerminalSnippet(command),command);
  assert.equal(prepareTerminalSnippet("a".repeat(MAX_SNIPPET_BYTES)).length,MAX_SNIPPET_BYTES);
});
test("snippet rejects multiline, controls, bidi overrides, empty and oversized input",()=>{
  for(const value of ["", "  ","pwd\nwhoami","echo\r","x\u001b[0m",
    "echo\u0000","hi\u007f","x\u0085","foo\u202e","hi\u2066bye\u2069",
    "a\tb","a".repeat(MAX_SNIPPET_BYTES+1),"🙂".repeat(1500)])
    assert.throws(()=>prepareTerminalSnippet(value));
});
