import {test,expect} from "@playwright/test";

test("open tabs can be reordered without changing the catalog",async({page})=>{
  const entry=(id,name)=>({id,name,host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false});
  await page.addInitScript(value=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value)),{
    version:1,groups:[],connections:[entry("one","One"),entry("two","Two")],language:"en",theme:"dark",monitoring:false
  });
  await page.goto("/");
  const before=await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"));
  await page.locator(".connection-open").filter({hasText:"One"}).click();
  await page.locator(".connection-open").filter({hasText:"Two"}).click();
  const titles=page.locator(".tabs .tab > button:first-child");
  await expect(titles).toHaveText(["One","Two"]);
  await titles.nth(1).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(titles).toHaveText(["Two","One"]);
  await page.locator(".tabs .tab").nth(1).dragTo(page.locator(".tabs .tab").nth(0));
  await expect(titles).toHaveText(["One","Two"]);
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
});
