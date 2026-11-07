import {test,expect} from "@playwright/test";

test("two and four pane layouts keep distinct tabs and never auto-connect",async({page})=>{
  const entry=(id)=>({id,name:id,host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false});
  await page.addInitScript(value=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value)),{
    version:1,groups:[],connections:["One","Two","Three","Four"].map(entry),language:"en",theme:"dark",monitoring:false
  });
  await page.goto("/");
  for(const name of ["One","Two","Three","Four"])await page.locator(".connection-open").filter({hasText:name}).click();
  await page.getByRole("button",{name:"Split",exact:true}).click();
  await expect(page.locator(".tab-pane:not([hidden])")).toHaveCount(2);
  await expect(page.locator('.tab-pane[data-slot="0"]')).toContainText("Four");
  await expect(page.locator('.tab-pane[data-slot="1"]')).toContainText("One");
  await page.getByRole("button",{name:"Four panes"}).click();
  await expect(page.locator(".tab-pane:not([hidden])")).toHaveCount(4);
  const selections=await page.locator(".pane-choice").evaluateAll(items=>items.map(item=>item.value));
  expect(selections).toEqual(["One","Two","Three"]);
  await page.evaluate(()=>{window.movingPane=document.querySelector('.tab-pane[data-slot="2"]');});
  await page.locator(".tabs .tab > button:first-child").filter({hasText:"Two"}).click();
  await expect(page.locator('.tab-pane[data-slot="0"]')).toContainText("Two");
  expect(await page.evaluate(()=>window.movingPane?.isConnected&&window.movingPane?.dataset.slot==="0")).toBe(true);
  expect(await page.locator(".pane-choice").evaluateAll(items=>items.map(item=>item.value))).toEqual(["One","Four","Three"]);
  await page.getByRole("button",{name:"Single pane"}).click();
  await expect(page.locator(".tab-pane:not([hidden])")).toHaveCount(1);
});
