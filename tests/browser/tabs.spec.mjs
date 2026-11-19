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


test("SSH jump-host settings are transient, explicit and never auto-connect",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={
      transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});return null;}
    };
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Quick Connect"}).click();
  const editor=page.getByRole("dialog");
  await editor.getByLabel("Name",{exact:true}).fill("Internal node");
  await editor.getByLabel("Host address").fill("internal.lan");
  await editor.getByLabel("Username").fill("operator");
  await editor.getByRole("button",{name:"Open tab"}).click();
  const ssh=page.locator('.ssh-tool-panel:not([hidden])');
  await ssh.getByRole('checkbox',{name:'Via SSH jump host (ProxyJump)'}).check();
  await ssh.getByRole('textbox',{name:'Jump host'}).fill('bastion.example.org');
  await ssh.getByRole('textbox',{name:'Jump username'}).fill('gateway');
  await ssh.getByRole('spinbutton',{name:'Jump port'}).fill('2222');
  expect(await page.evaluate(()=>window.calls.some(x=>x.cmd==='ssh_connect'))).toBe(false);
  await ssh.getByRole('button',{name:'Connect / reconnect'}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(x=>x.cmd==='ssh_connect').length)).toBe(1);
  const call=await page.evaluate(()=>window.calls.find(x=>x.cmd==='ssh_connect'));
  expect(call.args.jump).toEqual({host:'bastion.example.org',username:'gateway',port:2222});
  expect(call.args.host).toEqual('internal.lan');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nodedesk.catalog.v1')).connections)).toHaveLength(0);
});

test("SSH identity path is sent only on explicit key login and never saved",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});return null;}};
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Quick Connect"}).click();
  const editor=page.getByRole("dialog");
  await editor.getByLabel("Name",{exact:true}).fill("Fixture");
  await editor.getByLabel("Host address").fill("example.org");
  await editor.getByLabel("Username").fill("tester");
  await editor.getByRole("button",{name:"Open tab"}).click();
  const ssh=page.locator('.ssh-tool-panel:not([hidden])');
  await ssh.getByLabel("SSH authentication method").selectOption("key");
  await ssh.getByLabel("SSH identity file path").fill("/home/tester/.ssh/id_ed25519");
  expect(await page.evaluate(()=>window.calls.some(x=>x.cmd==='ssh_connect'))).toBe(false);
  await ssh.getByRole("button",{name:"Connect / reconnect"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(x=>x.cmd==='ssh_connect').length)).toBe(1);
  expect((await page.evaluate(()=>window.calls.find(x=>x.cmd==='ssh_connect'))).args.identity).toBe("/home/tester/.ssh/id_ed25519");
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).not.toContain("id_ed25519");
});
