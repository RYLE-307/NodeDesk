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
