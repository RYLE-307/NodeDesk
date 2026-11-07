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
  await pane.getByRole("button",{name:"Check TCP"}).click();
  await expect(pane.getByRole("status")).toContainText("TCP port 8080: reachable");
  expect(await page.evaluate(()=>window.calls)).toEqual([{cmd:"network_probe",args:{target:{host:"localhost",port:8080}}}]);
});


test("ICMP ping is explicit, bounded and does not use a port",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});if(cmd!=="network_ping")throw Error("Unexpected command");
        return {reachable:true,elapsedMs:31,output:"2 packets transmitted, 2 received"};}}
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Network diagnostics"}).click();
  const pane=page.getByRole("region",{name:"Network diagnostics"});
  expect(await page.evaluate(()=>window.calls)).toEqual([]);
  await pane.getByLabel("Host").fill("localhost");
  await pane.getByRole("button",{name:"Ping",exact:true}).click();
  await expect(pane.getByRole("status",{name:"Ping result"})).toContainText("reply received");
  await expect(pane.locator(".network-ping-output")).toContainText("2 packets transmitted");
  expect(await page.evaluate(()=>window.calls)).toEqual([
    {cmd:"network_ping",args:{target:{host:"localhost"}}}
  ]);
});
