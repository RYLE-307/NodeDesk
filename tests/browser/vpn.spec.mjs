import {test,expect} from "@playwright/test";

const UUID="123e4567-e89b-12d3-a456-426614174000";
async function open(page,{language="en",empty=false,fail=false,readOnly=false,holdImport=false,holdSet=false}={}) {
  await page.addInitScript(({language,empty,fail,readOnly,holdImport,holdSet,uuid})=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[],language,theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;
    window.fixture={
      calls:[], fail, holdImport, rejectImport:null, holdSet, rejectSet:null,
      profiles:empty?[]:[{id:uuid,name:"Office VPN",kind:"vpn",active:false,controlAllowed:!readOnly}]
    };
    let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},
      unregisterCallback(){},
      async invoke(cmd,args){
        window.fixture.calls.push({cmd,args});
        if(cmd==="vpn_list")return window.fixture.profiles;
        if(cmd==="vpn_import"){
          if(window.fixture.holdImport)return new Promise((_,reject)=>{window.fixture.rejectImport=reject;});
          if(window.fixture.fail)throw new Error("Import rejected");
          window.fixture.profiles=[...window.fixture.profiles,{id:"123e4567-e89b-12d3-a456-426614174099",
            name:"Imported fixture",kind:args.kind,active:false,controlAllowed:true}];
          return window.fixture.profiles;
        }
        if(cmd==="vpn_cancel_import"){
          window.fixture.rejectImport?.(new Error("cancelled"));
          return true;
        }
        if(cmd==="vpn_health"){
          const current=window.fixture.profiles.find(p=>p.id===args.profileId);
          return {profileId:current.id,active:current.active,
            routeConfigured:current.active,dnsConfigured:current.active};
        }
        if(cmd==="vpn_set"){
          if(window.fixture.holdSet)return new Promise((_,reject)=>{window.fixture.rejectSet=reject;});
          if(window.fixture.fail)throw new Error("System VPN manager rejected the request");
          window.fixture.profiles=window.fixture.profiles.map(p=>
            p.id===args.profileId ? {...p,active:args.connect}:p);
          return window.fixture.profiles;
        }
        if(cmd==="vpn_cancel_set"){
          window.fixture.rejectSet?.(new Error("VPN action cancelled; refresh system profiles"));
          return true;
        }
        throw new Error("Unexpected native command: "+cmd);
      }
    };
  },{language,empty,fail,readOnly,holdImport,holdSet,uuid:UUID});
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{
    name: language==="en"?"System VPN":"Системные VPN",exact:true
  }).click();
  const pane=page.getByRole("region",{name:language==="en"?"System VPN":"Системные VPN"});
  await expect(pane).toBeVisible();
  return pane;
}
test("VPN tab only lists profiles, never connects automatically, requires user confirmation",async({page})=>{
  const pane=await open(page);
  await expect(pane).toContainText("Office VPN");
  const initialLists=await page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_list").length);
  // React StrictMode can mount a component twice in development. Both calls
  // are read-only; neither is permitted to start a VPN connection.
  expect(initialLists).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set"))).toHaveLength(0);
  page.once("dialog",dialog=>dialog.dismiss());
  await pane.getByRole("button",{name:"Connect",exact:true}).click();
  expect(await page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set"))).toHaveLength(0);
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("Routes/DNS may change");
    dialog.accept();
  });
  await pane.getByRole("button",{name:"Connect",exact:true}).click();
  await expect(pane.getByRole("status")).toContainText('OS reported the new state');
  await expect(pane.getByRole("button",{name:"Disconnect",exact:true})).toBeVisible();
  const calls=await page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set"));
  expect(calls).toEqual([{cmd:"vpn_set",args:{profileId:UUID,
    expectedName:"Office VPN",expectedKind:"vpn",expectedActive:false,connect:true}}]);
  expect(JSON.stringify(calls)).not.toMatch(/password|secret|route/i);
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(pane.getByRole("button",{name:"Connect",exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set").length)).toBe(2);
  await pane.getByRole("button",{name:"Refresh VPNs"}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_list").length)).toBe(initialLists+1);
});
test("RU failures cannot fake a connected VPN and do not retry",async({page})=>{
  const pane=await open(page,{language:"ru",fail:true});
  await expect(pane.getByText("Подключён",{exact:true})).toHaveCount(0);
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Подключить"}).click();
  await expect(pane.getByRole("alert")).toContainText("System VPN manager rejected");
  await expect(pane.getByRole("button",{name:"Подключить"})).toBeVisible();
  await expect(pane.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set").length)).toBe(1);
});
test("empty system VPN list is not populated with fake connections",async({page})=>{
  const pane=await open(page,{empty:true});
  await expect(pane).toContainText("No supported VPN profiles found");
  await expect(pane.getByRole("button",{name:"Connect",exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set"))).toHaveLength(0);
});
test("read-only Windows profile is visible but cannot be dialed",async({page})=>{
  const pane=await open(page,{readOnly:true});
  await expect(pane).toContainText("Office VPN");
  await expect(pane).toContainText("Read-only — protocol or encryption policy unsupported");
  await expect(pane.getByRole("button",{name:"Connect",exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set"))).toHaveLength(0);
});

test("VPN activation locks UI until observed OS confirmation",async({page})=>{
  await page.addInitScript(({uuid})=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;
    window.pending={calls:[],profiles:[{id:uuid,name:"Disposable VPN",
      kind:"WireGuard",active:false,controlAllowed:true}],resolve:null};
    let callbackId=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++callbackId;},unregisterCallback(){},
      async invoke(cmd,args){
        window.pending.calls.push({cmd,args});
        if(cmd==="vpn_list")return window.pending.profiles;
        if(cmd==="vpn_set")return new Promise(resolve=>{
          window.pending.resolve=()=>{
            window.pending.profiles=window.pending.profiles.map(p=>({...p,active:args.connect}));
            resolve(window.pending.profiles);
          };
        });
        throw Error("Unexpected native command: "+cmd);
      }
    };
  },{uuid:UUID});
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"System VPN",exact:true}).click();
  const pane=page.getByRole("region",{name:"System VPN"});
  await expect(pane).toContainText("Disposable VPN");
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Connect",exact:true}).click();
  await expect(pane.getByRole("button",{name:"Working…"})).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>window.pending.calls.filter(x=>x.cmd==="vpn_set").length)).toBe(1);
  await page.evaluate(()=>window.pending.resolve());
  await expect(pane.getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.pending.calls.filter(x=>x.cmd==="vpn_set").length)).toBe(1);
});

test("VPN IPC carries displayed identity and state, never arbitrary commands",async({page})=>{
  const pane=await open(page);
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Connect",exact:true}).click();
  await expect(pane.getByRole("status")).toContainText("OS reported the new state");
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(pane.getByRole("button",{name:"Connect",exact:true})).toBeVisible();
  const calls=await page.evaluate(()=>window.fixture.calls.filter(x=>x.cmd==="vpn_set"));
  expect(calls.map(x=>x.args)).toEqual([
    {profileId:UUID,expectedName:"Office VPN",expectedKind:"vpn",expectedActive:false,connect:true},
    {profileId:UUID,expectedName:"Office VPN",expectedKind:"vpn",expectedActive:true,connect:false}
  ]);
  for (const call of calls) {
    expect(Object.keys(call.args).sort()).toEqual(
      ["profileId","expectedName","expectedKind","expectedActive","connect"].sort());
  }
});

test("VPN route and DNS evidence is explicit, redacted and cleared on refresh",async({page})=>{
  const pane=await open(page);
  await expect(pane).toContainText("Not checked");
  expect(await page.evaluate(()=>window.fixture.calls.filter(x=>x.cmd==="vpn_health"))).toHaveLength(0);
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Connect",exact:true}).click();
  await expect(pane.getByRole("button",{name:"Disconnect",exact:true})).toBeVisible();
  await pane.getByRole("button",{name:"Check",exact:true}).click();
  await expect(pane).toContainText("present / present");
  const checks=await page.evaluate(()=>window.fixture.calls.filter(x=>x.cmd==="vpn_health"));
  expect(checks).toEqual([{cmd:"vpn_health",args:{profileId:UUID}}]);
  expect(JSON.stringify(checks)).not.toMatch(/password|secret|address|route|dns/i);
  await pane.getByRole("button",{name:"Refresh VPNs"}).click();
  await expect(pane).toContainText("Not checked");
});

test("Linux VPN import is explicit and passes only a file path to native manager",async({page})=>{
  const pane=await open(page);
  const path=pane.getByLabel("Absolute file path");
  await expect(path).toBeVisible();
  await path.fill("/tmp/disposable-wireguard.conf");
  page.once("dialog",dialog=>dialog.dismiss());
  await pane.getByRole("button",{name:"Import profile"}).click();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==="vpn_import"))).toHaveLength(0);
  await path.fill("/tmp/disposable-wireguard.conf");
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Import profile"}).click();
  await expect(pane).toContainText("Imported fixture");
  await expect(path).toHaveValue("");
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==="vpn_import"));
  expect(calls).toEqual([{cmd:"vpn_import",args:{kind:"WireGuard",
    path:"/tmp/disposable-wireguard.conf"}}]);
  expect(JSON.stringify(await page.evaluate(()=>localStorage))).not.toContain("disposable-wireguard.conf");
});

test("Linux VPN import cancellation waits for native worker and clears path",async({page})=>{
  const pane=await open(page,{holdImport:true});
  await pane.getByLabel("Absolute file path").fill("/tmp/disposable-openvpn.ovpn");
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Import profile"}).click();
  await expect(pane.getByRole("button",{name:"Cancel import"})).toBeVisible();
  await expect(pane.getByLabel("Absolute file path")).toHaveValue("");
  await pane.getByRole("button",{name:"Cancel import"}).click();
  await expect(pane.getByRole("alert")).toContainText("Import cancelled");
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd.startsWith("vpn_")));
  expect(calls.map(c=>c.cmd)).toContain("vpn_cancel_import");
});

test("VPN connection cancellation leaves state uncertain until refresh",async({page})=>{
  const pane=await open(page,{holdSet:true});
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Connect",exact:true}).click();
  await expect(pane.getByRole("button",{name:"Cancel",exact:true})).toBeVisible();
  await pane.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(pane.getByRole("alert")).toContainText("cancelled");
  const commands=await page.evaluate(()=>window.fixture.calls.map(call=>call.cmd));
  expect(commands).toContain("vpn_cancel_set");
  expect(commands.filter(command=>command==="vpn_set")).toHaveLength(1);
  await expect(pane).toContainText("Disconnected");
});

test("Linux VPN import failure cannot invent a profile or retain a file path",async({page})=>{
  const pane=await open(page,{fail:true});
  await pane.getByLabel("Absolute file path").fill("/tmp/disposable-openvpn.ovpn");
  await pane.getByLabel("Profile type").selectOption("OpenVPN");
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Import profile"}).click();
  await expect(pane.getByRole("alert")).toContainText("Import was rejected");
  await expect(pane.getByText("Imported fixture")).toHaveCount(0);
  await expect(pane.getByLabel("Absolute file path")).toHaveValue("");
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==="vpn_import"))).toEqual([
    {cmd:"vpn_import",args:{kind:"OpenVPN",path:"/tmp/disposable-openvpn.ovpn"}}
  ]);
});
