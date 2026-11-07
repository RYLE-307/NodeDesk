import {test,expect} from "@playwright/test";

test("Quick Connect opens a transient tab without saving or auto-connecting",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
  });
  await page.goto("/");
  const before=await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"));
  await page.locator(".catalog-tools").getByRole("button",{name:"Quick Connect"}).click();
  const editor=page.getByRole("dialog");
  await editor.getByLabel("Name",{exact:true}).fill("Temporary SSH");
  await editor.getByLabel("Host address").fill("example.org");
  await editor.getByLabel("Username").fill("admin");
  await editor.getByRole("button",{name:"Open tab"}).click();
  await expect(page.getByRole("button",{name:"Close: Temporary SSH"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Connect / reconnect"})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
  await page.getByRole("button",{name:"Close: Temporary SSH"}).click();
  await expect(page.getByRole("button",{name:"Close: Temporary SSH"})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
});
