import {test,expect} from "@playwright/test";

test("local shell requires a click and closes its process with the tab",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args:args&&{...args,events:undefined}});}
    };
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Local terminal"}).click();
  const pane=page.getByRole("region",{name:"Local terminal"});
  await expect(pane).toBeVisible();
  expect(await page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_connect"))).toHaveLength(0);
  await pane.getByRole("button",{name:"Start"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_connect").length)).toBe(1);
  const calls=await page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_connect"));
  expect(calls[0].args.kind).toBe("local");
  expect(calls[0].args.host).toBe("");
  expect(calls[0].args.username).toBe("");
  await page.getByRole("button",{name:"Close: Local terminal"}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_disconnect").length)).toBe(1);
});

test("terminal tools change font and guard multiline paste without a session",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false})));
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Local terminal"}).click();
  const pane=page.getByRole("region",{name:"Local terminal"});
  await pane.getByRole("button",{name:"Increase font size"}).click();
  await expect(pane.locator('[aria-label="Font size"]')).toHaveText("14px");
  await pane.getByRole("button",{name:"Decrease font size"}).click();
  await expect(pane.locator('[aria-label="Font size"]')).toHaveText("13px");
  await pane.getByRole("textbox",{name:"Find in output"}).fill("needle");
  await expect(pane.getByRole("button",{name:"Next match"})).toBeEnabled();
  const prevented=await pane.locator(".ssh-screen").evaluate(element=>{
    window.confirm=()=>false;
    const clipboardData=new DataTransfer();clipboardData.setData("text/plain","first\nsecond");
    const event=new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData});
    element.dispatchEvent(event);return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
});
