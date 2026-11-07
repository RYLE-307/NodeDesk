import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const config=JSON.parse(read("package.json"));
const lock=JSON.parse(read("package-lock.json"));
const tauri=JSON.parse(read("src-tauri/tauri.conf.json"));

test("release candidate versions stay aligned across npm, Tauri, Cargo and lockfiles",()=>{
  const version=config.version;
  assert.match(version,/^\d+\.\d+\.\d+-rc\.\d+$/);
  assert.equal(version,"0.7.0-rc.1");
  assert.equal(lock.version,version);
  assert.equal(lock.packages[""].version,version);
  assert.equal(tauri.version,version);
  const cargo=read("src-tauri/Cargo.toml");
  const cargoLock=read("src-tauri/Cargo.lock");
  assert.match(cargo,new RegExp(`^version = "${version.replaceAll(".","\\.")}"$`,"m"));
  const packageBlock=cargoLock.match(/\[\[package\]\]\s+name = "nodedesk"\s+version = "([^"]+)"/);
  assert.equal(packageBlock?.[1],version);
  assert.equal(tauri.bundle.active,false,"bundled installers require separate native acceptance");
});

test("candidate notes and third-party license notices exist for direct npm runtime deps",()=>{
  const notes=read("docs/RELEASE-NOTES-V0.7.0.md");
  const acceptance=read("docs/V0.7-ACCEPTANCE.md");
  const notices=read("docs/THIRD-PARTY-NOTICES.md");
  assert.match(notes,/NOT a published|NOT yet released|NOT a published/);
  assert.match(acceptance,/Windows/);
  assert.match(acceptance,/Arch/);
  assert.match(notices,/not a complete\s+binary SBOM/);
  for(const name of Object.keys(config.dependencies)){
    const pkg=lock.packages[`node_modules/${name}`];
    assert.ok(pkg?.license,`missing locked runtime license: ${name}`);
    assert.ok(notices.includes(`\`${name}\``),`missing notice for ${name}`);
    assert.ok(notices.includes(pkg.license),`license ${pkg.license} missing from notices`);
  }
});
