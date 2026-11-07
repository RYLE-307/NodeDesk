import {test,expect} from "@playwright/test";

// Contract-only UI fixture. Does NOT spawn an OS RDP client.
// Native Rust argument tests check the actual launcher's safety.
async function open(page,language="en",launchError=false) {
  await page.addInitScript(({language,launchError}) => {
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],
      connections:[{id:"rdp-fixture",name:"Fixture RDP",host:"rdp.example.test",port:3390,
        username:"LAB\\alice",protocol:"RDP",groupId:null,favorite:false}],
      language,theme:"dark",monitoring:false
    }));
    window.__TAURI__={};
    window.isTauri=true;
    window.fixture={calls:[]};
    let index=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++index;},
      unregisterCallback(){},
      async invoke(cmd,args) {
        window.fixture.calls.push({cmd,args});
        if(cmd!=="rdp_launch") throw new Error("Unexpected command");
        if(launchError) throw new Error("RDP client unavailable");
        return {client:"sdl-freerdp3",externalWindow:true};
      }
    };
  },{language,launchError});
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Fixture RDP"}).dblclick();
  return page.getByRole("region",{name:language==="en"?"RDP remote desktop":"Удалённый рабочий стол RDP"});
}
test("RDP never autoconnects; explicit launch sends only catalog target",async({page})=>{
  const workspace=await open(page);
  await expect(workspace).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.calls)).toHaveLength(0);
  await workspace.getByRole("button",{name:"Open RDP"}).click();
  await expect(workspace.getByRole("status")).toContainText("External RDP client launched");
  const calls=await page.evaluate(()=>window.fixture.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({cmd:"rdp_launch",args:{
    target:{host:"rdp.example.test",port:3390,username:"LAB\\alice"}
  }});
  await expect(workspace).toContainText("not embedded in this tab");
  await expect(workspace).toContainText("Verify the server certificate");
});
test("RU language and launch failures never imply authenticated RDP",async({page})=>{
  const workspace=await open(page,"ru",true);
  await expect(workspace).toBeVisible();
  await workspace.getByRole("button",{name:"Открыть RDP"}).click();
  await expect(workspace.getByRole("alert")).toContainText("RDP client unavailable");
  await expect(workspace.getByRole("status")).toHaveCount(0);
  await expect(workspace).toContainText("Пароль вводится только там");
});
