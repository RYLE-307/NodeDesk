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
  await pane.getByRole("spinbutton",{name:"Port",exact:true}).fill("8080");
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


test("traceroute is manual and displays bounded route output",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});if(cmd!=="network_trace")throw Error("Unexpected command");
        return {elapsedMs:42,output:"1  127.0.0.1  0.2 ms"};}}
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Network diagnostics"}).click();
  const pane=page.getByRole("region",{name:"Network diagnostics"});
  expect(await page.evaluate(()=>window.calls)).toEqual([]);
  await pane.getByLabel("Host").fill("localhost");
  await pane.getByRole("button",{name:"Traceroute",exact:true}).click();
  await expect(pane.getByRole("status",{name:"Traceroute result"})).toContainText("Traceroute finished");
  await expect(pane.locator(".network-ping-output")).toContainText("127.0.0.1");
  expect(await page.evaluate(()=>window.calls)).toEqual([
    {cmd:"network_trace",args:{target:{host:"localhost"}}}
  ]);
});


test("explicit TCP port list runs only on click and rejects ranges and duplicates",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});if(cmd!=="network_scan_ports")throw Error("Unexpected command");
        return {addresses:["127.0.0.1"],results:[{port:22,reachable:false},{port:443,reachable:true}],elapsedMs:5};}}
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Network diagnostics"}).click();
  const pane=page.getByRole("region",{name:"Network diagnostics"});
  await pane.getByLabel("Host").fill("localhost");
  const input=pane.getByLabel("TCP ports (comma-separated)");
  await input.fill("22-443");
  await pane.getByRole("button",{name:"Check ports"}).click();
  await expect(pane.getByRole("alert")).toContainText("no ranges");
  expect(await page.evaluate(()=>window.calls)).toEqual([]);
  await input.fill("22,22");
  await pane.getByRole("button",{name:"Check ports"}).click();
  await expect(pane.getByRole("alert")).toContainText("distinct");
  expect(await page.evaluate(()=>window.calls)).toEqual([]);
  await input.fill("22, 443");
  await pane.getByRole("button",{name:"Check ports"}).click();
  await expect(pane.getByRole("status",{name:"Port check result"})).toContainText("TCP 443: reachable");
  await expect(pane.getByRole("status",{name:"Port check result"})).toContainText("TCP 22: no response");
  expect(await page.evaluate(()=>window.calls)).toEqual([
    {cmd:"network_scan_ports",args:{target:{host:"localhost",ports:[22,443]}}}
  ]);
});


test("changing diagnostic target invalidates in-flight results and does not start a new probe",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={
      transformCallback(){return 1;},unregisterCallback(){},
      invoke(cmd,args){
        window.calls.push({cmd,args});
        if(cmd!=="network_probe")throw Error("Unexpected diagnostics command");
        return new Promise(resolve=>{window.completeOldProbe=resolve;});
      }
    };
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Network diagnostics"}).click();
  const pane=page.getByRole("region",{name:"Network diagnostics"});
  await pane.getByLabel("Host").fill("test-old.local");
  await pane.getByRole("button",{name:"Check TCP"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(1);
  await pane.getByLabel("Host").fill("test-new.local");
  await page.evaluate(()=>window.completeOldProbe({
    addresses:["198.51.100.1"],tcpReachable:true,elapsedMs:2
  }));
  await expect(pane.getByRole("button",{name:"Check TCP"})).toBeEnabled();
  await expect(pane.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(()=>window.calls.map(x=>x.args.target.host)))
    .toEqual(["test-old.local"]);
});

test("network report downloads only completed results for the current target",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});
        if(cmd==="network_probe")return {addresses:["127.0.0.1"],tcpReachable:true,elapsedMs:3};
        throw Error("Unexpected command");}}
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Network diagnostics"}).click();
  const pane=page.getByRole("region",{name:"Network diagnostics"});
  const downloadButton=pane.getByRole("button",{name:"Download report"});
  await expect(downloadButton).toBeDisabled();
  await pane.getByLabel("Host").fill("localhost");
  await pane.getByRole("spinbutton",{name:"Port",exact:true}).fill("8080");
  await pane.getByRole("button",{name:"Check TCP"}).click();
  await expect(downloadButton).toBeEnabled();
  const event=page.waitForEvent("download");
  await downloadButton.click();
  const download=await event;
  expect(download.suggestedFilename()).toBe("nodedesk-network-report.json");
  const fs=await import("node:fs/promises");
  const report=JSON.parse(await fs.readFile(await download.path(),"utf8"));
  expect(report).toMatchObject({version:1,target:{host:"localhost"},
    tcp:{port:8080,addresses:["127.0.0.1"],tcpReachable:true,elapsedMs:3},
    ping:null,trace:null,ports:null});
  await pane.getByLabel("Host").fill("another.local");
  await expect(downloadButton).toBeDisabled();
  expect(await page.evaluate(()=>window.calls)).toHaveLength(1);
});
