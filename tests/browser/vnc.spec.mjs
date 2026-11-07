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
  await expect(workspace).toContainText("Пароль вводите только в TigerVNC");
  expect(await page.evaluate(()=>window.fixture.calls.length)).toBe(1);
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

/**
 * Isolated WebSocket-backed RFB 3.8 peer. Unlike a Tauri invoke mock, this
 * exercises noVNC's real protocol handshake and canvas lifecycle.
 * Deliberately a test-only peer; no production credentials or server used.
 */
function rfbPeer(ws,securityType){
  let stage="version",sentFrame=false;
  ws.onMessage(message=>{
    const data=Buffer.isBuffer(message)?message:Buffer.from(message);
    if(stage==="version"){
      if(data.toString()!=="RFB 003.008\n")return;
      stage="security";
      ws.send(Buffer.from([1,securityType]));
    }else if(stage==="security"){
      if(data[0]!==securityType)return;
      if(securityType===2){
        stage="answer";
        ws.send(Buffer.alloc(16,0x2a));
      }else{
        stage="clientinit";
        ws.send(Buffer.alloc(4)); // SecurityResult success
      }
    }else if(stage==="answer"){
      if(data.length!==16)return;
      stage="clientinit";
      ws.send(Buffer.alloc(4)); // Accept disposable VNCAuth response
    }else if(stage==="clientinit"){
      if(data.length!==1)return;
      stage="active";
      const name=Buffer.from("NodeDesk RFB test");
      const init=Buffer.alloc(24+name.length);
      init.writeUInt16BE(320,0);init.writeUInt16BE(240,2);
      init.set([32,24,0,1],4); // bpp, depth, endian, true color
      init.writeUInt16BE(255,8);init.writeUInt16BE(255,10);init.writeUInt16BE(255,12);
      init.set([16,8,0],14);
      init.writeUInt32BE(name.length,20);name.copy(init,24);
      ws.send(init);
    }else if(stage==="active" && data[0]===3 && !sentFrame){
      sentFrame=true;
      const update=Buffer.alloc(20);
      update.writeUInt16BE(1,2); // one rectangle
      update.writeUInt16BE(0,4);update.writeUInt16BE(0,6);
      update.writeUInt16BE(1,8);update.writeUInt16BE(1,10);
      update.writeInt32BE(0,12); // Raw encoding
      update.set([0,0,255,0],16); // red pixel, little endian
      ws.send(update);
    }
  });
  ws.send(Buffer.from("RFB 003.008\n"));
}

test("embedded noVNC rejects a server that skips RFB authentication",async({page})=>{
  await page.routeWebSocket("wss://rfb.test/vnc",ws=>rfbPeer(ws,1));
  const workspace=await open(page);
  const viewer=workspace.locator(".vnc-embedded");
  await viewer.getByRole("textbox",{name:"WSS endpoint"}).fill("wss://rfb.test/vnc");
  await viewer.getByRole("button",{name:"Connect embedded"}).click();
  await expect(viewer.getByRole("alert")).toContainText("did not request authentication");
  await expect(viewer.getByRole("button",{name:"Connect embedded"})).toBeEnabled();
});

test("noVNC negotiates password-authenticated RFB and displays an in-tab framebuffer",async({page})=>{
  await page.routeWebSocket("wss://rfb.test/vnc",ws=>rfbPeer(ws,2));
  const workspace=await open(page);
  const viewer=workspace.locator(".vnc-embedded");
  await viewer.getByRole("textbox",{name:"WSS endpoint"}).fill("wss://rfb.test/vnc");
  await viewer.getByRole("button",{name:"Connect embedded"}).click();
  await expect(viewer.getByRole("textbox",{name:"VNC password"})).toBeVisible();
  await viewer.getByRole("textbox",{name:"VNC password"}).fill("disposable-test-only");
  await viewer.getByRole("button",{name:"Authenticate"}).click();
  await expect(viewer.getByRole("status")).toContainText("VNC connected");
  await expect(viewer.locator(".vnc-embedded-surface canvas")).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.calls)).toEqual([]);
  await viewer.getByRole("button",{name:"Disconnect"}).click();
  await expect(viewer.getByRole("button",{name:"Connect embedded"})).toBeEnabled();
});
