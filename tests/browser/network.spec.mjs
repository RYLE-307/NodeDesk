import {test,expect} from "@playwright/test";

test("network diagnostics make no request until click and show bounded result",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});if(cmd!=="network_probe")throw Error("Unexpected command");
        return {addresses:["127.0.0.1"],tcpReachable:true,elapsedMs:2};}}
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Network diagnostics"}).click();
  const pane=page.getByRole("region",{name:"Network diagnostics"});
  await expect(pane).toBeVisible();
  expect(await page.evaluate(()=>window.calls)).toEqual([]);
  await pane.getByLabel("Host").fill("localhost");
  await pane.getByLabel("Port").fill("8080");
  await pane.getByRole("button",{name:"Check"}).click();
  await expect(pane.getByRole("status")).toContainText("TCP port 8080: reachable");
  expect(await page.evaluate(()=>window.calls)).toEqual([{cmd:"network_probe",args:{target:{host:"localhost",port:8080}}}]);
});
