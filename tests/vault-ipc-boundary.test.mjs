import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rustLib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const rustVault=readFileSync(new URL("../src-tauri/src/vault.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../src/VaultWorkspace.tsx",import.meta.url),"utf8");

test("saved vault secrets are never exposed by native-to-WebView IPC",()=>{
  const forbidden=["vault"+"_"+"get"];
  for(const command of forbidden){
    assert.equal(rustLib.includes(command),false,"No registered secret-read command");
    assert.equal(rustVault.includes(`fn ${command}(`),false,"No native exported secret-read endpoint");
    assert.equal(ui.includes(command),false,"No UI secret-read invocation");
  }
  assert.equal(ui.includes("Reveal for 15 seconds"),false);
  assert.equal(ui.includes("Temporary reveal"),false);
  assert.match(rustLib,/vault::vault_put/);
  assert.match(rustLib,/vault::vault_has/);
  assert.match(rustLib,/vault::vault_delete/);
  assert.match(rustVault,/pub\(crate\) fn read_connection\(/);
});
