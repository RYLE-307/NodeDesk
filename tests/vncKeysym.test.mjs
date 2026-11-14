import test from "node:test";
import assert from "node:assert/strict";
import {vncKeysym} from "../src/vncKeysym.ts";

test("direct VNC maps ordinary, non-ASCII and navigation keys",()=>{
  assert.equal(vncKeysym("a"),0x61);
  assert.equal(vncKeysym("Ж"),0x01000416);
  assert.equal(vncKeysym("ArrowLeft"),0xff51);
  assert.equal(vncKeysym("Enter"),0xff0d);
  assert.equal(vncKeysym("UnknownNamedKey"),0);
});
