import test from "node:test";
import assert from "node:assert/strict";
import {MAX_EDITOR_BYTES, adjacentMatch, countLiteral, replaceAllLiteral,
  replaceLiteralSelection, safeEditorText} from "../src/textEditorSearch.ts";

test("literal search uses UTF-16 textarea offsets and wraps in both directions",()=>{
  const text="foo Привет foo\nfoo";
  assert.equal(countLiteral(text,"foo"),3);
  assert.deepEqual(adjacentMatch(text,"foo",0,"next"),{start:0,end:3});
  assert.deepEqual(adjacentMatch(text,"foo",3,"next"),{start:11,end:14});
  assert.deepEqual(adjacentMatch(text,"foo",0,"previous"),{start:15,end:18});
  assert.deepEqual(adjacentMatch(text,"Привет",0,"next"),{start:4,end:10});
  assert.equal(adjacentMatch(text,"missing",0,"next"),null);
  assert.equal(countLiteral(text,""),0);
  assert.equal(countLiteral(text,"x".repeat(257)),0);
});
test("replacement is literal and only works with an exact selection",()=>{
  const text="a.b a.b";
  assert.equal(replaceLiteralSelection(text,"a.b","ok",0,3),"ok a.b");
  assert.equal(replaceLiteralSelection(text,"a.b","ok",0,2),null);
  assert.equal(replaceLiteralSelection(text,"a.b","ok",4,7),"a.b ok");
  assert.deepEqual(replaceAllLiteral(text,"a.b","$&"),{text:"$& $&",count:2});
  assert.deepEqual(replaceAllLiteral("один один","один","два"),{text:"два два",count:2});
  assert.equal(replaceAllLiteral("abc","", "anything"),null);
  assert.equal(replaceAllLiteral("abc","x","anything"),null);
});
test("safety limits block oversized or control-containing edits",()=>{
  assert.equal(safeEditorText("plain\ntext\tтекст"),true);
  assert.equal(safeEditorText("not\0text"),false);
  assert.equal(safeEditorText("unsafe\x1btext"),false);
  assert.equal(safeEditorText("a".repeat(MAX_EDITOR_BYTES+1)),false);
  assert.equal(replaceAllLiteral("x".repeat(4097),"x","y"),null);
  assert.equal(replaceAllLiteral("a".repeat(4096),"a","z".repeat(40)),null);
});
