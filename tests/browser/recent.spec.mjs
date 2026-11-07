import {test,expect} from "@playwright/test";

test("recent entries persist as IDs without saving transient connections",async({page})=>{
  const entry=(id,name)=>({id,name,host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false});
  await page.addInitScript(value=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value)),{
    version:1,groups:[],connections:[entry("one","One"),entry("two","Two")],language:"en",theme:"dark",monitoring:false
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"One"}).click();
  await page.locator(".connection-open").filter({hasText:"Two"}).click();
  await page.locator(".catalog-tools").getByRole("button",{name:"Recent"}).click();
  await expect(page.locator(".connection-open")).toHaveCount(2);
  await expect(page.locator(".connection-open")).toHaveText([/Two/,/One/]);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("nodedesk.recent.v1")))).toEqual(["two","one"]);
  await page.reload();
  await page.locator(".catalog-tools").getByRole("button",{name:"Recent"}).click();
  await expect(page.locator(".connection-open")).toHaveText([/Two/,/One/]);
});
