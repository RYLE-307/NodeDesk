import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const sources=[
  ["RDP","../src-tauri/src/direct_rdp.rs","rdp_direct_connect"],
  ["VNC","../src-tauri/src/direct_vnc.rs","vnc_direct_connect"],
];
for(const [name,source,connectName] of sources){
  test(name+" saved credentials stay in Zeroizing ownership until protocol handoff",()=>{
    const rust=readFileSync(new URL(source,import.meta.url),"utf8");
    const start=rust.indexOf("pub async fn "+connectName+"_saved(");
    const end=rust.indexOf("#[tauri::command]",start+1);
    assert.ok(start>=0&&end>start,"saved command boundary exists");
    const saved=rust.slice(start,end);
    assert.match(saved,/let secret = tauri::async_runtime::spawn_blocking/);
    assert.ok(!saved.includes("secret.to_string()"),"no unmanaged Vault secret copy");
    assert.ok(saved.includes(connectName+"_guarded("),"moves native Vault secret directly");

    const guarded=rust.indexOf("fn "+connectName+"_guarded(");
    assert.ok(guarded>=0,"private guarded entrypoint exists");
    const guardedSignature=rust.slice(guarded,guarded+350);
    assert.match(guardedSignature,/mut password:\s*(?:zeroize::)?Zeroizing<String>/);
    assert.ok(!guardedSignature.includes("password.to_string()"));
    const publicEntry=rust.indexOf("pub async fn "+connectName+"(");
    assert.ok(publicEntry>=0);
    const publicBody=rust.slice(publicEntry,guarded);
    assert.match(publicBody,/Zeroizing::new\(password\)/);
  });
}

test("saved desktop connections validate public metadata and duplicate IDs before accessing the vault",()=>{
  for(const [name,source,connectName] of sources){
    const rust=readFileSync(new URL(source,import.meta.url),"utf8");
    const start=rust.indexOf("pub async fn "+connectName+"_saved(");
    const end=rust.indexOf("#[tauri::command]",start+1);
    assert.ok(start>=0&&end>start,name+" saved-command boundary");
    const saved=rust.slice(start,end);
    const validation=saved.indexOf("preflight_saved_connect(&target,");
    const duplicate=saved.indexOf("active.contains_key(&target.id)");
    const read=saved.indexOf("store.read_connection(");
    assert.ok(validation>=0&&duplicate>validation&&read>duplicate,
      name+": reject invalid or active target before Vault secret lookup");
    assert.ok(saved.includes("let secret = tauri::async_runtime::spawn_blocking"),
      name+": keep saved credentials only on native side");
  }
});
