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

test("terminal paste rejects control sequences and oversize, but permits confirmed multiline",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false})));
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Local terminal"}).click();
  const pane=page.getByRole("region",{name:"Local terminal"});
  const decisions=await pane.locator(".ssh-screen").evaluate(element=>{
    const paste=text=>{
      const clipboardData=new DataTransfer();clipboardData.setData("text/plain",text);
      const event=new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData});
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    let confirmations=0;
    window.confirm=()=>{confirmations++;return true;};
    const normal=paste("whoami");
    const escaped=paste("whoami\u001b[0m");
    const oversized=paste("a".repeat(16385));
    const multiline=paste("pwd\nwhoami");
    return {normal,escaped,oversized,multiline,confirmations};
  });
  expect(decisions).toEqual({normal:false,escaped:true,oversized:true,multiline:false,confirmations:1});
  await expect(pane.getByRole("status")).toContainText("Paste blocked");
});

test("terminal copy requires selected terminal text and never reads clipboard implicitly",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false})));
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Local terminal"}).click();
  const pane=page.getByRole("region",{name:"Local terminal"});
  await pane.getByRole("button",{name:"Copy selected text"}).click();
  await expect(pane.getByRole("status")).toContainText("Select terminal output to copy");
  await expect(pane.getByRole("button",{name:"Copy selected text"})).toBeEnabled();
});

test("terminal snippet inserts exact text without Enter, consent or persistence bypass",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;window.calls=[];let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},unregisterCallback(){},
      async invoke(cmd,args){window.calls.push({cmd,args});}
    };
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Local terminal"}).click();
  const pane=page.getByRole("region",{name:"Local terminal"});
  const input=pane.getByRole("textbox",{name:"Command snippet"});
  const button=pane.getByRole("button",{name:"Insert (no Enter)"});
  await input.fill("printf 'hello'");
  await expect(button).toBeDisabled();
  await pane.getByRole("button",{name:"Start"}).click();
  await expect(button).toBeEnabled();
  page.once("dialog",d=>d.dismiss());
  await button.click();
  expect(await page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_write"))).toHaveLength(0);
  page.once("dialog",d=>{expect(d.message()).toContain("WITHOUT Enter");d.accept();});
  await button.click();
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_write").length)).toBe(1);
  expect((await page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_write")))[0].args.data).toBe("printf 'hello'");
  expect(JSON.stringify(await page.evaluate(()=>localStorage))).not.toContain("printf 'hello'");
  await expect(input).toHaveValue("");
  await input.fill("pwd\u202eunsafe");
  await button.click();
  await expect(pane.getByRole("status")).toContainText("Invalid snippet");
  expect(await page.evaluate(()=>window.calls.filter(c=>c.cmd==="ssh_write"))).toHaveLength(1);
  await pane.getByRole("button",{name:"Stop"}).click();
  await expect(button).toBeDisabled();
});


test("terminal log export never starts a session or creates a download for empty scrollback",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
    version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false
  })));
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Local terminal"}).click();
  const pane=page.getByRole("region",{name:"Local terminal"});
  let downloads=0;
  page.on("download",()=>{downloads++;});
  await pane.getByRole("button",{name:"Export terminal scrollback"}).click();
  await expect(pane.getByRole("status")).toContainText("No terminal scrollback to export");
  expect(downloads).toBe(0);
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).not.toContain("terminal-log");
});
