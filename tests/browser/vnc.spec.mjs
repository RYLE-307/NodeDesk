import {test, expect} from "@playwright/test";

// Browser UI contract only: does not create an actual VNC connection.
async function open(page,language="en",error=false) {
  await page.addInitScript(({language,error}) => {
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],
      connections:[{id:"vnc-fixture",name:"Fixture VNC",host:"vnc.example.test",
        port:5901,username:"unused-catalog-user",protocol:"VNC",groupId:null,favorite:false}],
      language,theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;window.fixture={calls:[]};
    let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},
      unregisterCallback(){},
      async invoke(cmd,args) {
        window.fixture.calls.push({cmd,args});
        if(cmd==="vnc_direct_connect"||cmd==="vnc_direct_connect_saved"||cmd==="vnc_direct_disconnect"||cmd==="vnc_direct_input")return;
        if(cmd!=="vnc_launch") throw new Error("Unexpected native command");
        if(error) throw new Error("TigerVNC Viewer not found");
        return {client:"TigerVNC",security:"X509Vnc,X509Plain",externalWindow:true};
      }
    };
  },{language,error});
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Fixture VNC"}).dblclick();
  return page.getByRole("region",{name:language==="en"?"VNC remote desktop":"Удалённый рабочий стол VNC"});
}
test("VNC launch requires a click, sends only endpoint and warns about X509 trust",async({page})=>{
  const workspace=await open(page);
  await expect(workspace).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.calls)).toEqual([]);
  await expect(workspace).toContainText("must support X509Vnc or X509Plain");
  await expect(workspace).toContainText("Clipboard sharing is disabled");
  await workspace.getByRole("button",{name:"Open VNC"}).click();
  await expect(workspace.getByRole("status")).toContainText("TigerVNC launched");
  const calls=await page.evaluate(()=>window.fixture.calls);
  expect(calls).toEqual([{cmd:"vnc_launch",args:{target:{host:"vnc.example.test",port:5901}}}]);
  expect(JSON.stringify(calls)).not.toContain("unused-catalog-user");
  expect(JSON.stringify(calls)).not.toContain("password");
});
test("RU VNC errors do not imply login success or retry automatically",async({page})=>{
  const workspace=await open(page,"ru",true);
  await expect(workspace).toBeVisible();
  await workspace.getByRole("button",{name:"Открыть VNC"}).click();
  await expect(workspace.getByRole("alert")).toContainText("TigerVNC Viewer not found");
  await expect(workspace.getByRole("status")).toHaveCount(0);
  await expect(workspace).toContainText("Пароль для него вводите только в TigerVNC");
  expect(await page.evaluate(()=>window.fixture.calls.length)).toBe(1);
});

test("direct VNC requires verified SPKI before sending a transient password",async({page})=>{
  const workspace=await open(page);
  const direct=workspace.getByRole("region",{name:"Direct VNC"});
  await expect(direct).toBeVisible();
  await direct.getByLabel("VNC password for this session").fill("fixture-only");
  await direct.getByRole("button",{name:"Connect directly"}).click();
  await expect(direct.getByRole("alert")).toContainText("verified SHA256 SPKI");
  expect(await page.evaluate(()=>window.fixture.calls)).toEqual([]);
  await direct.getByLabel("Verified SHA256 SPKI fingerprint").fill("ab".repeat(32));
  await direct.getByLabel("VNC password for this session").fill("fixture-only");
  await direct.getByRole("button",{name:"Connect directly"}).click();
  await expect(direct.getByLabel("VNC password for this session")).toHaveValue("");
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==="vnc_direct_connect")
    .map(c=>({target:c.args.target,pin:c.args.spkiSha256,password:c.args.password,clipboard:c.args.clipboard})));
  expect(calls).toEqual([{target:{id:"vnc-fixture",host:"vnc.example.test",port:5901,
    username:"unused-catalog-user"},pin:"ab".repeat(32),password:"fixture-only",clipboard:false}]);
  expect(JSON.stringify(await page.evaluate(()=>localStorage))).not.toContain("fixture-only");
  await direct.getByRole("button",{name:"Disconnect"}).click();
});

test("saved VNC credential stays behind native vault command",async({page})=>{
  const workspace=await open(page);
  const direct=workspace.getByRole("region",{name:"Direct VNC"});
  await direct.getByLabel("VNC password for this session").fill("discard-me");
  await direct.getByLabel("Use password from unlocked OS vault").check();
  await expect(direct.getByLabel("VNC password for this session")).toHaveCount(0);
  await direct.getByLabel("Verified SHA256 SPKI fingerprint").fill("ab".repeat(32));
  await direct.getByRole("button",{name:"Connect directly"}).click();
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==="vnc_direct_connect_saved"));
  expect(calls).toHaveLength(1);
  expect(calls[0].args.target).toEqual({id:"vnc-fixture",host:"vnc.example.test",port:5901,
    username:"unused-catalog-user"});
  expect(calls[0].args.spkiSha256).toBe("ab".repeat(32));
  expect(calls[0].args).not.toHaveProperty("password");
  expect(JSON.stringify(await page.evaluate(()=>localStorage))).not.toContain("discard-me");
  await direct.getByRole("button",{name:"Disconnect"}).click();
});

test("embedded VNC is a real in-tab viewer but never autoconnects",async({page})=>{
  const workspace=await open(page);
  const viewer=workspace.locator(".vnc-embedded");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("Embedded VNC (secure WSS)");
  await expect(viewer.getByRole("button",{name:"Connect embedded"})).toBeVisible();
  await expect(viewer.locator(".vnc-embedded-surface")).toBeVisible();
  // WSS is never opened just because the tab exists.
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==="vnc_launch"))).toHaveLength(0);
  await viewer.getByRole("textbox",{name:"WSS endpoint"}).fill("ws://unsecured.example/rfb");
  await viewer.getByRole("button",{name:"Connect embedded"}).click();
  await expect(viewer.getByRole("alert")).toContainText("Enter a valid WSS endpoint");
  await expect(viewer.getByRole("button",{name:"Connect embedded"})).toBeEnabled();
  expect(await page.evaluate(()=>window.fixture.calls)).toEqual([]);
});

test("embedded VNC refuses URL password and query-token leakage",async({page})=>{
  const workspace=await open(page,"ru");
  const viewer=workspace.locator(".vnc-embedded");
  for(const bad of [
    "wss://user:password@vnc.example/rfb",
    "wss://vnc.example/rfb?token=secret",
    "wss://vnc.example/rfb#secret"
  ]){
    await viewer.getByRole("textbox",{name:"WSS-адрес"}).fill(bad);
    await viewer.getByRole("button",{name:"Подключить внутри"}).click();
    await expect(viewer.getByRole("alert")).toContainText("Only wss://");
  }
});

test("embedded VNC clipboard is absent before authenticated RFB connection",async({page})=>{
  await page.addInitScript(()=>{
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=function(url,protocol){
      if(!String(url).startsWith("wss://fixture.example.test/"))
        return new NativeWebSocket(url,protocol);
      const socket={readyState:0,send(){},close(){this.readyState=3;}};
      setTimeout(()=>socket.onerror?.(new Event("error")),0);
      return socket;
    };
  });
  const workspace=await open(page);
  const viewer=workspace.locator(".vnc-embedded");
  await expect(viewer.getByRole("button",{name:"Copy remote text"})).toHaveCount(0);
  await expect(viewer.getByRole("button",{name:"Send local text"})).toHaveCount(0);
  await viewer.getByRole("textbox",{name:"WSS endpoint"}).fill("wss://fixture.example.test/rfb");
  // A refused disposable WSS connection never exposes clipboard controls.
  await viewer.getByRole("button",{name:"Connect embedded"}).click();
  await expect(viewer.getByRole("button",{name:"Copy remote text"})).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain("fixture-only-secret");
});

