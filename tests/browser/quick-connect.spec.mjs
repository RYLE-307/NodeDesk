import {test,expect} from "@playwright/test";

test("Quick Connect opens a transient tab without saving or auto-connecting",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
  });
  await page.goto("/");
  const before=await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"));
  await page.locator(".catalog-tools").getByRole("button",{name:"Quick Connect"}).click();
  const editor=page.getByRole("dialog");
  await editor.getByLabel("Name",{exact:true}).fill("Temporary SSH");
  await editor.getByLabel("Host address").fill("example.org");
  await editor.getByLabel("Username").fill("admin");
  await editor.getByRole("button",{name:"Open tab"}).click();
  await expect(page.getByRole("button",{name:"Close: Temporary SSH"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Connect / reconnect"})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
  await page.getByRole("button",{name:"Close: Temporary SSH"}).click();
  await expect(page.getByRole("button",{name:"Close: Temporary SSH"})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
});


test("read-only SSH config preview fills Quick Connect without commands or auto-connect",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;
    window.__TAURI_INTERNALS__={
      transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd){
        window.invocations=(window.invocations||[]).concat(cmd);
        if(cmd!=="ssh_config_preview")throw Error("No network action expected");
        return [{alias:"lab-ssh",host:"192.0.2.50",port:2222,username:"operator"}];
      }
    };
  });
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Quick Connect"}).click();
  const editor=page.getByRole("dialog");
  await editor.getByRole("button",{name:"Preview local SSH config"}).click();
  await editor.getByRole("combobox",{name:"SSH config host"}).selectOption("lab-ssh");
  await expect(editor.getByLabel("Host address")).toHaveValue("192.0.2.50");
  await expect(editor.getByLabel("Username")).toHaveValue("operator");
  await expect(editor.getByLabel("Port")).toHaveValue("2222");
  await expect(editor.getByLabel("Name",{exact:true})).toHaveValue("lab-ssh");
  expect(await page.evaluate(()=>window.invocations)).toEqual(["ssh_config_preview"]);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("nodedesk.catalog.v1")).connections))
    .toHaveLength(0);
  await editor.getByRole("button",{name:"Open tab"}).click();
  await expect(page.getByRole("button",{name:"Close: lab-ssh"})).toBeVisible();
  expect(await page.evaluate(()=>window.invocations)).toEqual(["ssh_config_preview"]);
});
