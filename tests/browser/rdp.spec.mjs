import {test,expect} from "@playwright/test";

// Contract-only UI fixture. Does NOT spawn an OS RDP client.
// Native Rust argument tests check the actual launcher's safety.
async function open(page,language="en",launchError=false) {
  await page.addInitScript(({language,launchError}) => {
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],
      connections:[{id:"rdp-fixture",name:"Fixture RDP",host:"rdp.example.test",port:3390,
        username:"LAB\\alice",protocol:"RDP",groupId:null,favorite:false}],
      language,theme:"dark",monitoring:false
    }));
    window.__TAURI__={};
    window.isTauri=true;
    window.fixture={calls:[]};
    let index=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++index;},
      unregisterCallback(){},
      async invoke(cmd,args) {
        window.fixture.calls.push({cmd,args});
        if(cmd!=="rdp_launch") throw new Error("Unexpected command");
        if(launchError) throw new Error("RDP client unavailable");
        return {client:"sdl-freerdp3",externalWindow:true};
      }
    };
  },{language,launchError});
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Fixture RDP"}).dblclick();
  return page.getByRole("region",{name:language==="en"?"RDP remote desktop":"Удалённый рабочий стол RDP"});
}
test("RDP never autoconnects; explicit launch sends only catalog target",async({page})=>{
  const workspace=await open(page);
  await expect(workspace).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.calls)).toHaveLength(0);
  await workspace.getByRole("button",{name:"Open RDP"}).click();
  await expect(workspace.getByRole("status")).toContainText("External RDP client launched");
  const calls=await page.evaluate(()=>window.fixture.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({cmd:"rdp_launch",args:{
    target:{host:"rdp.example.test",port:3390,username:"LAB\\alice"}
  }});
  await expect(workspace).toContainText("embedded viewer above requires a separately configured Guacamole/WSS gateway");
  await expect(workspace).toContainText("Verify the server certificate");
});
test("saved SHA256 pin reaches the launcher and invalid edits are refused",async({page})=>{
  const workspace=await open(page);
  const pin="B3:FD:DF:E2:A1:35:B7:00:CD:0F:8D:A6:B7:15:FA:59:3E:5A:6F:56:7B:F5:C9:4F:C6:D0:10:32:03:D8:68:67";
  await page.locator(".connection-open").filter({hasText:"Fixture RDP"}).click({button:"right"});
  await page.getByRole("menu").getByRole("button",{name:/Edit/}).click();
  await page.getByRole("textbox",{name:"RDP SHA256 fingerprint"}).fill("/cert:ignore");
  await page.getByRole("button",{name:"Save"}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("textbox",{name:"RDP SHA256 fingerprint"}).fill(pin);
  await page.getByRole("button",{name:"Save"}).click();
  await workspace.getByRole("button",{name:"Open RDP"}).click();
  const calls=await page.evaluate(()=>window.fixture.calls);
  expect(calls.at(-1).args.target.rdpSha256Fingerprint).toBe(pin.replaceAll(":","").toLowerCase());
});
test("RU language and launch failures never imply authenticated RDP",async({page})=>{
  const workspace=await open(page,"ru",true);
  await expect(workspace).toBeVisible();
  await workspace.getByRole("button",{name:"Открыть RDP"}).click();
  await expect(workspace.getByRole("alert")).toContainText("RDP client unavailable");
  await expect(workspace.getByRole("status")).toHaveCount(0);
  await expect(workspace).toContainText("Пароль вводится только там");
});

test("embedded Guacamole login is opt-in, no autoconnect, no saved credentials",async({page})=>{
  const workspace=await open(page);
  const embedded=workspace.getByRole("region",{name:"Embedded RDP"});
  await expect(embedded).toContainText("Embedded RDP through Guacamole");
  await expect(embedded.getByRole("button",{name:"Sign in to Guacamole"})).toBeDisabled();
  await expect(embedded.getByLabel("RDP remote screen")).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.calls)).toEqual([]);
  expect(await page.evaluate(()=>localStorage.getItem("GUAC_AUTH"))).toBeNull();
});

test("embedded Guacamole rejects cleartext and credential-bearing API URLs",async({page})=>{
  const workspace=await open(page);
  const embedded=workspace.getByRole("region",{name:"Embedded RDP"});
  await embedded.getByRole("checkbox").check();
  for(const bad of ["http://host/guacamole/","https://user:pass@host/guacamole/",
    "https://host/guacamole/?token=secret","https://host/guacamole/#secret"]){
    await embedded.getByRole("textbox",{name:"Guacamole HTTPS URL"}).fill(bad);
    await embedded.getByRole("textbox",{name:"Guacamole username"}).fill("user");
    await embedded.getByRole("textbox",{name:"Guacamole password"}).fill("disposable");
    await embedded.getByRole("button",{name:"Sign in to Guacamole"}).click();
    await expect(embedded.getByRole("alert")).toBeVisible();
    await expect(embedded.getByRole("button",{name:"Sign in to Guacamole"})).toBeEnabled();
    expect(await page.evaluate(()=>window.fixture.calls)).toEqual([]);
  }
});

async function mockGuac(page){
  const endpoint="https://guacamole.example.org/guacamole/";
  const auth={authToken:"opaque-qa-token",dataSource:"postgresql",
    availableDataSources:["postgresql"]};
  const routes=[];
  await page.route(endpoint+"api/tokens",async route=>{
    routes.push("login");
    await route.fulfill({status:200,contentType:"application/json",
      headers:{"access-control-allow-origin":"*"},
      body:JSON.stringify(auth)});
  });
  await page.route(endpoint+"api/session/data/postgresql/connections?*",async route=>{
    routes.push("list");
    await route.fulfill({status:200,contentType:"application/json",
      headers:{"access-control-allow-origin":"*"},
      body:JSON.stringify({
        42:{identifier:"42",name:"Disposable Windows RDP",protocol:"rdp"},
        70:{identifier:"70",name:"Not an RDP machine",protocol:"vnc"}
      })});
  });
  await page.route(endpoint+"api/tokens/opaque-qa-token",async route=>{
    routes.push("logout");
    await route.fulfill({status:204,headers:{"access-control-allow-origin":"*"}});
  });
  return routes;
}
test("Guacamole account login discovers only authorized RDP machines and clears password",async({page})=>{
  const routes=await mockGuac(page);
  const workspace=await open(page);
  const embedded=workspace.getByRole("region",{name:"Embedded RDP"});
  await embedded.getByRole("textbox",{name:"Guacamole HTTPS URL"}).fill(
    "https://guacamole.example.org/guacamole/");
  await embedded.getByRole("textbox",{name:"Guacamole username"}).fill("qa-user");
  await embedded.getByRole("textbox",{name:"Guacamole password"}).fill("test-only-password");
  await embedded.getByRole("checkbox").check();
  await embedded.getByRole("button",{name:"Sign in to Guacamole"}).click();
  await expect(embedded.getByRole("combobox",{name:"Authorized RDP connection"})).toHaveValue(
    "postgresql:42");
  await expect(embedded.getByRole("combobox")).not.toContainText("Not an RDP machine");
  await expect(embedded.getByRole("button",{name:"Connect embedded"})).toBeVisible();
  await expect(embedded).not.toContainText("test-only-password");
  expect(routes).toEqual(["login","list"]);
  expect(await page.evaluate(()=>localStorage.getItem("GUAC_AUTH"))).toBeNull();
  await embedded.getByRole("button",{name:"Sign out"}).click();
  await expect(embedded.getByRole("button",{name:"Sign in to Guacamole"})).toBeVisible();
  await expect.poll(()=>routes.includes("logout")).toBe(true);
});

test("explicit RDP connection uses only a server-authorized Guacamole profile",async({page})=>{
  await page.addInitScript(()=>{
    const NativeWebSocket=window.WebSocket;
    window.testGuacSockets=[];
    // Intercept only the Guacamole WSS transport; keep Vite HMR working.
    window.WebSocket=function(url,protocol){
      if(String(url).startsWith("wss://guacamole.example.org/")){
        window.testGuacSockets.push({url:String(url),protocol});
        return {readyState:1,send(){},close(){}};
      }
      return new NativeWebSocket(url,protocol);
    };
  });
  await mockGuac(page);
  const workspace=await open(page);
  const embedded=workspace.getByRole("region",{name:"Embedded RDP"});
  await embedded.getByRole("textbox",{name:"Guacamole HTTPS URL"}).fill(
    "https://guacamole.example.org/guacamole/");
  await embedded.getByRole("textbox",{name:"Guacamole username"}).fill("qa");
  await embedded.getByRole("textbox",{name:"Guacamole password"}).fill("test-only-secret");
  await embedded.getByRole("checkbox").check();
  await embedded.getByRole("button",{name:"Sign in to Guacamole"}).click();
  await expect(embedded.getByRole("combobox")).toHaveValue("postgresql:42");
  expect(await page.evaluate(()=>window.testGuacSockets.length)).toBe(0);
  await embedded.getByRole("button",{name:"Connect embedded"}).click();
  const captures=await page.evaluate(()=>window.testGuacSockets);
  expect(captures).toHaveLength(1);
  const {url,protocol}=captures[0];
  const parsed=new URL(url);
  expect(protocol).toBe("guacamole");
  expect(parsed.protocol).toBe("wss:");
  expect(parsed.pathname).toBe("/guacamole/websocket-tunnel");
  expect(parsed.searchParams.get("GUAC_ID")).toBe("42");
  expect(parsed.searchParams.get("GUAC_DATA_SOURCE")).toBe("postgresql");
  expect(parsed.searchParams.get("GUAC_TYPE")).toBe("c");
  expect(parsed.searchParams.get("token")).toBe("opaque-qa-token");
  expect(parsed.searchParams.has("password")).toBe(false);
  expect(await page.evaluate(()=>localStorage.getItem("GUAC_AUTH"))).toBeNull();
  await expect(embedded).not.toContainText("opaque-qa-token");
});
