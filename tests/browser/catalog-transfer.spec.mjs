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
  await page.locator('input[type="file"]').setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from("bad")});
  await expect(page.getByRole("status").last()).toContainText("failed validation");
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);

  page.once("dialog",dialog=>dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({name:"new.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(catalog([connection("second","Second")])))});
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
