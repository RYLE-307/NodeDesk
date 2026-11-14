import {test} from "node:test";
import assert from "node:assert/strict";
import {boundedRemoteClipboard,REMOTE_CLIPBOARD_LIMIT} from "../src/remoteClipboard.ts";

test("remote desktop clipboard text is bounded in UTF-8 and refuses controls",()=>{
  assert.equal(boundedRemoteClipboard("hello\nмир"),"hello\nмир");
  assert.equal(boundedRemoteClipboard("x".repeat(REMOTE_CLIPBOARD_LIMIT)).length,REMOTE_CLIPBOARD_LIMIT);
  for(const value of ["","x".repeat(REMOTE_CLIPBOARD_LIMIT+1),"🧪".repeat(20000),
      "a\u001bb","a\u0000b","a\u202eb"])
    assert.throws(()=>boundedRemoteClipboard(value));
});
