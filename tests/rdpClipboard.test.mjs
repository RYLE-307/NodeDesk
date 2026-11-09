import {test} from "node:test";
import assert from "node:assert/strict";
import {boundedRdpClipboard,RDP_CLIPBOARD_LIMIT} from "../src/rdpClipboard.ts";

test("RDP clipboard text is bounded in UTF-8 and refuses controls",()=>{
  assert.equal(boundedRdpClipboard("hello\nмир"),"hello\nмир");
  assert.equal(boundedRdpClipboard("x".repeat(RDP_CLIPBOARD_LIMIT)).length,RDP_CLIPBOARD_LIMIT);
  for(const value of ["","x".repeat(RDP_CLIPBOARD_LIMIT+1),"🧪".repeat(20000),
      "a\u001bb","a\u0000b","a\u202eb"])
    assert.throws(()=>boundedRdpClipboard(value));
});
