import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

const connection=(id,name)=>({id,name,host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false,password:"never-export"});
const catalog=(connections)=>({version:1,groups:[],connections,language:"en",theme:"dark",monitoring:false});

test("catalog export/import excludes secrets and rejects invalid replacement",async({page})=>{
  await page.addInitScript(value=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value)),catalog([connection("first","First")]));
  await page.goto("/");
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"Export catalog"}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe("nodedesk-catalog.json");
  const exported=JSON.parse(await readFile(await download.path(),"utf8"));
  expect(exported.connections[0].name).toBe("First");
  expect(JSON.stringify(exported)).not.toContain("never-export");

  const before=await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"));
  await page.locator('input[accept=".json,application/json"]').setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from("bad")});
  await expect(page.getByRole("status").last()).toContainText("failed validation");
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);

  page.once("dialog",dialog=>dialog.accept());
  await page.locator('input[accept=".json,application/json"]').setInputFiles({name:"new.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(catalog([connection("second","Second")])))});
  await expect(page.getByRole("status").last()).toContainText("Catalog imported");
  const imported=JSON.parse(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1")));
  expect(imported.connections.map(c=>c.name)).toEqual(["Second"]);
  expect(JSON.stringify(imported)).not.toContain("never-export");
});

test("merge catalog keeps current sessions, rekeys imported IDs and never imports secrets",async({page})=>{
  const original=connection("same-id","Existing");
  await page.addInitScript(value=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value)),
    catalog([original]));
  await page.goto("/");
  const incoming=catalog([connection("same-id","Imported")]);
  incoming.groups=[{id:"group-1",name:"Imported group",parentId:null}];
  incoming.connections[0].groupId="group-1";
  incoming.connections[0].password="not-a-stored-password";
  const chooser=page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Merge catalog"}).click();
  page.once("dialog",dialog=>dialog.accept());
  await (await chooser).setFiles({name:"backup.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify(incoming))});
  await expect(page.getByRole("status").last()).toContainText("Catalog merged");
  const merged=JSON.parse(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1")));
  expect(merged.connections).toHaveLength(2);
  expect(merged.connections[0].id).toBe("same-id");
  expect(merged.connections[0].name).toBe("Existing");
  expect(merged.connections[1].name).toBe("Imported");
  expect(merged.connections[1].id).not.toBe("same-id");
  expect(merged.connections[1].groupId).toBe(merged.groups[0].id);
  expect(merged.groups[0].id).not.toBe("group-1");
  expect(JSON.stringify(merged)).not.toContain("not-a-stored-password");

  const before=JSON.stringify(merged);
  const chooser2=page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Merge catalog"}).click();
  page.once("dialog",dialog=>dialog.dismiss());
  await (await chooser2).setFiles({name:"backup.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify(incoming))});
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
});

test("MobaXterm import adds only supported plain endpoints without saving secrets",async({page})=>{
  await page.addInitScript(value=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value)),
    catalog([connection("existing","Existing")]));
  await page.goto("/");
  const moba=[
    "[Bookmarks]","SubRep=","ImgNum=42",
    "SSH server=#109#0%ssh.example.org%2222%admin%%0%0",
    "Ignored telnet=#98#1%legacy.example.org%23%root",
    "[Bookmarks_1]","SubRep=Clients\\Production","ImgNum=41",
    "RDP server=#91#4%rdp.example.org%3389%operator%0%0",
    "VNC server=#128#5%vnc.example.org%5900%-1%0",
  ].join("\r\n");
  const chooser=page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Import MobaXterm"}).click();
  page.once("dialog",dialog=>{expect(dialog.message()).toContain("3 imported, 1 skipped");dialog.accept();});
  await (await chooser).setFiles({name:"sessions.mxtsessions",mimeType:"text/plain",buffer:Buffer.from(moba)});
  await expect(page.getByRole("status").last()).toContainText("MobaXterm sessions added");
  const imported=JSON.parse(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1")));
  expect(imported.connections.map(c=>c.name)).toEqual(["Existing","SSH server","RDP server","VNC server"]);
  expect(imported.connections.map(c=>c.protocol)).toEqual(["SSH","SSH","RDP","VNC"]);
  expect(imported.groups.map(g=>g.name)).toEqual(["Clients","Production"]);
  expect(imported.connections[2].groupId).toBe(imported.groups[1].id);
  expect(imported.connections[3].groupId).toBe(imported.groups[1].id);
  expect(imported.connections[1].id).not.toBe("moba-connection-1");
  expect(JSON.stringify(imported)).not.toContain("never-export");

  const unchanged=JSON.stringify(imported);
  const chooser2=page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Import MobaXterm"}).click();
  await (await chooser2).setFiles({name:"invalid.mxtsessions",mimeType:"text/plain",
    buffer:Buffer.from("[Bookmarks]\r\nUnsupported=#98#1%telnet.example%23\r\n")});
  await expect(page.getByRole("status").last()).toContainText("catalog unchanged");
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(unchanged);
});


test("bulk SSH config import appends safe previews without reading keys or auto-connect",async({page})=>{
  const original=connection("first","Existing");
  await page.addInitScript(value=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value));
    window.__TAURI__={};window.isTauri=true;
    window.sshCalls=[];let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},unregisterCallback(){},
      async invoke(command){
        window.sshCalls.push(command);
        if(command==="ssh_config_preview")return [
          {alias:"LAB",host:"lab.example.test",port:2222,username:"operator",
            identityFile:"/private/secret-key",proxyCommand:"not-imported"},
          {alias:"WEB",host:"web.example.test",port:22,username:""}
        ];
      },
    };
  },catalog([original]));
  await page.goto("/");
  const importButton=page.getByRole("button",{name:"Import SSH config"});
  page.once("dialog",dialog=>{expect(dialog.message()).toContain("(2)");dialog.accept();});
  await importButton.click();
  await expect(page.getByRole("status").last()).toContainText("SSH config entries added");
  const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1")));
  expect(saved.connections.map(c=>c.name)).toEqual(["Existing","LAB","WEB"]);
  expect(saved.connections[1]).toMatchObject({host:"lab.example.test",port:2222,username:"operator",protocol:"SSH"});
  expect(saved.connections[2].username).toBe("");
  expect(saved.connections[1].id).not.toBe("ssh-preview-1");
  expect(JSON.stringify(saved)).not.toContain("secret-key");
  expect(JSON.stringify(saved)).not.toContain("proxyCommand");
  expect(await page.evaluate(()=>window.sshCalls)).toEqual(["ssh_config_preview"]);
  const before=JSON.stringify(saved);
  page.once("dialog",dialog=>dialog.dismiss());
  await importButton.click();
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
});
test("malformed SSH config preview fails without modifying the catalog",async({page})=>{
  await page.addInitScript(value=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value));
    window.__TAURI__={};window.isTauri=true;
    window.__TAURI_INTERNALS__={
      transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd){
        if(cmd==="ssh_config_preview")
          return [{alias:"bad",host:"-oProxyCommand=evil",port:22,username:"root"}];
      },
    };
  },catalog([connection("first","Existing")]));
  await page.goto("/");
  const before=await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"));
  await page.getByRole("button",{name:"Import SSH config"}).click();
  await expect(page.getByRole("status").last()).toContainText("catalog unchanged");
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
});
