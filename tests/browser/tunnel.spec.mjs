import {test,expect} from "@playwright/test";

test("local SSH forwarding is explicit, loopback scoped and closes with its tab",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[{id:"ssh",name:"Lab",host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false}],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];let next=0;
    window.__TAURI_INTERNALS__={transformCallback(){return ++next;},unregisterCallback(){},async invoke(cmd,args){window.calls.push({cmd,args:{...args,events:undefined}});}};
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Lab"}).click();
  await page.getByRole("tab",{name:"Tunnel"}).click();
  const pane=page.getByRole("region",{name:"Local SSH tunnel"});
  expect(await page.evaluate(()=>window.calls.filter(item=>item.cmd==="tunnel_start"))).toHaveLength(0);
  await pane.getByRole("button",{name:"Start tunnel"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(item=>item.cmd==="tunnel_start").length)).toBe(1);
  const call=await page.evaluate(()=>window.calls.find(item=>item.cmd==="tunnel_start"));
  expect(call.args.spec).toMatchObject({sshHost:"example.org",sshPort:22,username:"admin",localPort:15432,kind:"local",targetHost:"127.0.0.1",targetPort:5432});
  await pane.getByRole("button",{name:"Stop tunnel"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(item=>item.cmd==="tunnel_stop").length)).toBe(1);
});

test("dynamic SOCKS tunnel has no fixed target and is explicit",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[{id:"ssh",name:"Lab",host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false}],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];let next=0;
    window.__TAURI_INTERNALS__={transformCallback(){return ++next;},unregisterCallback(){},async invoke(cmd,args){window.calls.push({cmd,args:{...args,events:undefined}});}};
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Lab"}).click();
  await page.getByRole("tab",{name:"Tunnel"}).click();
  const pane=page.getByRole("region",{name:"Local SSH tunnel"});
  await pane.getByRole("combobox",{name:"Tunnel mode"}).selectOption("dynamic");
  await expect(pane.getByLabel("Target host")).toHaveCount(0);
  await expect(pane.getByText(/Local programs can use this SOCKS5 port/)).toBeVisible();
  expect(await page.evaluate(()=>window.calls.filter(x=>x.cmd==="tunnel_start"))).toHaveLength(0);
  await pane.getByRole("button",{name:"Start tunnel"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(x=>x.cmd==="tunnel_start").length)).toBe(1);
  const spec=await page.evaluate(()=>window.calls.find(x=>x.cmd==="tunnel_start").args.spec);
  expect(spec).toMatchObject({kind:"dynamic",localPort:15432,targetHost:"",targetPort:0});
  await pane.getByRole("button",{name:"Stop tunnel"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(x=>x.cmd==="tunnel_stop").length)).toBe(1);
});


test("remote SSH forwarding requires confirmation and requests remote loopback only",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[{id:"ssh",name:"Lab",host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false}],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];let next=0;
    window.__TAURI_INTERNALS__={transformCallback(){return ++next;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args:{...args,events:undefined}});}};
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Lab"}).click();
  await page.getByRole("tab",{name:"Tunnel"}).click();
  const pane=page.getByRole("region",{name:"Local SSH tunnel"});
  await pane.getByRole("combobox",{name:"Tunnel mode"}).selectOption("remote");
  await expect(pane.getByLabel("Remote port")).toBeVisible();
  await expect(pane.getByLabel("Local port")).toHaveCount(0);
  await expect(pane.getByLabel("Target host")).toHaveCount(0);
  await pane.getByLabel("Remote port").fill("18443");
  await pane.getByLabel("Local target port").fill("8080");
  page.once("dialog",d=>d.dismiss());
  await pane.getByRole("button",{name:"Start tunnel"}).click();
  expect(await page.evaluate(()=>window.calls.filter(c=>c.cmd==="tunnel_start"))).toHaveLength(0);
  page.once("dialog",d=>d.accept());
  await pane.getByRole("button",{name:"Start tunnel"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.cmd==="tunnel_start").length)).toBe(1);
  const spec=await page.evaluate(()=>window.calls.find(c=>c.cmd==="tunnel_start").args.spec);
  expect(spec).toMatchObject({kind:"remote",localPort:0,remotePort:18443,targetHost:"127.0.0.1",targetPort:8080});
  await pane.getByRole("button",{name:"Stop tunnel"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.cmd==="tunnel_stop").length)).toBe(1);
});
