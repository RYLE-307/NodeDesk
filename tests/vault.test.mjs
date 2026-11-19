import {test} from "node:test";
import assert from "node:assert/strict";
import {vaultTarget} from "../src/vaultModel.ts";

test("vault identity forwards only public connection fields",()=>{
  const source={id:"id",protocol:"SSH",host:"lab.local",port:2222,
    username:"fixture",name:"Lab",groupId:null,favorite:false,
    password:"must-not-persist",token:"must-not-forward"};
  assert.deepEqual(vaultTarget(source),{id:"id",protocol:"SSH",host:"lab.local",
    port:2222,username:"fixture"});
  assert.doesNotMatch(JSON.stringify(vaultTarget(source)),/must-not/);
});
