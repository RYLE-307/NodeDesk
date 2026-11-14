import {test,expect} from "@playwright/test";

test("SSH and SFTP consoles pass a transient target identity separately from the jump",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[{id:"ssh",name:"Lab",host:"target.internal",
      port:22,username:"deploy",protocol:"SSH",groupId:null,favorite:false}],
      language:"en",theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;window.calls=[];let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args:{...args,events:undefined}});
        if(cmd==="files_capabilities")return {interactiveLogin:false,keyAgent:true};
      }
    };
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Lab"}).click();
  for(const kind of ["SSH","SFTP"]){
    await page.getByRole("tab",{name:kind,exact:true}).click();
    const panel=page.locator('.ssh-tool-panel:not([hidden])');
    await panel.getByRole("combobox",{name:"SSH authentication method"}).selectOption("key");
    await panel.getByRole("checkbox",{name:"Via SSH jump host (ProxyJump)"}).check();
    await panel.getByRole("textbox",{name:"Jump host"}).fill("bastion.example.org");
    await panel.getByRole("textbox",{name:"Jump username"}).fill("gateway");
    await panel.getByRole("spinbutton",{name:"Jump port"}).fill("2222");
    const key=panel.getByRole("textbox",{name:"SSH identity file path"});
    await expect(key).toBeVisible();
    await key.fill("/tmp/target_only_key");
    expect(await page.evaluate(()=>window.calls.filter(x=>x.cmd==="ssh_connect"))).toHaveLength(kind==="SSH"?0:1);
    await panel.getByRole("button",{name:"Connect / reconnect"}).click();
    await expect.poll(()=>page.evaluate(()=>window.calls.filter(x=>x.cmd==="ssh_connect").length)).toBe(kind==="SSH"?1:2);
    const call=await page.evaluate(()=>window.calls.filter(x=>x.cmd==="ssh_connect").at(-1));
    expect(call.args).toMatchObject({
      kind:kind.toLowerCase(),auth:"key",identity:"/tmp/target_only_key",
      jump:{host:"bastion.example.org",username:"gateway",port:2222}
    });
  }
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain("target_only_key");
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain("bastion.example.org");
});

test("two-hop SSH uses ordered validated jump fields without persisting them",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[{id:"ssh",name:"Lab",host:"target.internal",
        port:22,username:"deploy",protocol:"SSH",groupId:null,favorite:false}],
      language:"en",theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;window.calls=[];let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args:{...args,events:undefined}});
        if(cmd==="files_capabilities")return {interactiveLogin:false,keyAgent:true};
      }
    };
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Lab"}).click();
  await page.getByRole("tab",{name:"SSH",exact:true}).click();
  const panel=page.locator(".ssh-tool-panel:not([hidden])");
  await panel.getByRole("combobox",{name:"SSH authentication method"}).selectOption("key");
  await panel.getByRole("checkbox",{name:"Via SSH jump host (ProxyJump)"}).check();
  await panel.getByRole("textbox",{name:"Jump host",exact:true}).fill("bastion.example.org");
  await panel.getByRole("textbox",{name:"Jump username",exact:true}).fill("operator");
  await panel.getByRole("spinbutton",{name:"Jump port",exact:true}).fill("2201");
  await panel.getByRole("checkbox",{name:"Add second SSH jump host"}).check();
  await panel.getByRole("textbox",{name:"Second jump host"}).fill("edge.example.org");
  await panel.getByRole("textbox",{name:"Second jump username"}).fill("edge");
  await panel.getByRole("spinbutton",{name:"Second jump port"}).fill("2202");
  await panel.getByRole("textbox",{name:"SSH identity file path"}).fill("/tmp/target-only-key");
  await panel.getByRole("button",{name:"Connect / reconnect"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(x=>x.cmd==="ssh_connect").length)).toBe(1);
  const args=await page.evaluate(()=>window.calls.find(x=>x.cmd==="ssh_connect").args);
  expect(args).toMatchObject({
    identity:"/tmp/target-only-key",
    jump:{host:"bastion.example.org",username:"operator",port:2201,
      next:{host:"edge.example.org",username:"edge",port:2202}}
  });
  expect(JSON.stringify(await page.evaluate(()=>localStorage))).not.toContain("edge.example.org");
});
