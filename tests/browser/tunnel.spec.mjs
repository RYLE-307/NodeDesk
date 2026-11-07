import {test,expect} from "@playwright/test";

test("local SSH forwarding is explicit, loopback scoped and closes with its tab",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[{id:"ssh",name:"Lab",host:"example.org",port:22,username:"admin",protocol:"SSH",groupId:null,favorite:false}],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.calls=[];let next=0;
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
  expect(call.args.spec).toMatchObject({sshHost:"example.org",sshPort:22,username:"admin",localPort:15432,targetHost:"127.0.0.1",targetPort:5432});
  await pane.getByRole("button",{name:"Stop tunnel"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(item=>item.cmd==="tunnel_stop").length)).toBe(1);
});
