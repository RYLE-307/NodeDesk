import test from "node:test";
import assert from "node:assert/strict";
import {sshConfigPreviewToCatalog} from "../src/sshConfigImport.ts";

test("SSH config import keeps only identity-free, validated endpoints",()=>{
  const values=[
    {alias:"LAB",host:"lab.example.test",port:2222,username:"operator",
      identityFile:"/home/operator/.ssh/id_rsa",proxyCommand:"unsafe-to-import",password:"secret"},
    {alias:"web",host:"[::1]",port:22,username:""},
  ];
  const output=sshConfigPreviewToCatalog(values);
  assert.deepEqual(output.connections.map(c=>[c.name,c.host,c.port,c.username]),[
    ["LAB","lab.example.test",2222,"operator"],
    ["web","[::1]",22,""],
  ]);
  assert.equal(output.connections[0].id,"ssh-preview-1");
  assert.ok(!JSON.stringify(output).includes("id_rsa"));
  assert.ok(!JSON.stringify(output).includes("proxyCommand"));
  assert.ok(!JSON.stringify(output).includes("secret"));
});

test("SSH config import rejects unsafe fields, duplicate aliases and overlarge previews",()=>{
  const good={alias:"host",host:"host.example.test",port:22,username:"operator"};
  for(const item of [
    {...good,host:"-oProxyCommand=evil"},
    {...good,host:"https://user:pass@host"},
    {...good,username:"-oProxyCommand=evil"},
    {...good,port:0},{...good,port:65536},{...good,port:"22"},
    {...good,alias:"*"}, {...good,alias:"hi there"},
    {...good,username:"root;sh"}
  ])assert.throws(()=>sshConfigPreviewToCatalog([item]));
  assert.throws(()=>sshConfigPreviewToCatalog([good,{...good,alias:"HOST"}]));
  assert.throws(()=>sshConfigPreviewToCatalog(Array.from({length:41},(_,i)=>({...good,alias:"host"+i}))));
  assert.deepEqual(sshConfigPreviewToCatalog([]).connections,[]);
  assert.throws(()=>sshConfigPreviewToCatalog("host"));
});
