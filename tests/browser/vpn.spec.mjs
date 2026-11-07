import {test,expect} from "@playwright/test";

const UUID="123e4567-e89b-12d3-a456-426614174000";
async function open(page,{language="en",empty=false,fail=false}={}) {
  await page.addInitScript(({language,empty,fail,uuid})=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],connections:[],language,theme:"dark",monitoring:false
    }));
    window.__TAURI__={};window.isTauri=true;
    window.fixture={
      calls:[], fail, profiles:empty?[]:[{id:uuid,name:"Office VPN",kind:"vpn",active:false}]
    };
    let next=0;
    window.__TAURI_INTERNALS__={
      transformCallback(){return ++next;},
      unregisterCallback(){},
      async invoke(cmd,args){
        window.fixture.calls.push({cmd,args});
        if(cmd==="vpn_list")return window.fixture.profiles;
        if(cmd==="vpn_set"){
          if(window.fixture.fail)throw new Error("System VPN manager rejected the request");
          window.fixture.profiles=window.fixture.profiles.map(p=>
            p.id===args.profileId ? {...p,active:args.connect}:p);
          return window.fixture.profiles;
        }
        throw new Error("Unexpected native command: "+cmd);
      }
    };
  },{language,empty,fail,uuid:UUID});
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
  expect(await page.evaluate(()=>window.fixture.calls.map(v=>v.cmd))).toEqual(["vpn_list"]);
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
  expect(calls).toEqual([{cmd:"vpn_set",args:{profileId:UUID,connect:true}}]);
  expect(JSON.stringify(calls)).not.toMatch(/password|secret|route/i);
  page.once("dialog",dialog=>dialog.accept());
  await pane.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(pane.getByRole("button",{name:"Connect",exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_set").length)).toBe(2);
  await pane.getByRole("button",{name:"Refresh VPNs"}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(v=>v.cmd==="vpn_list").length)).toBe(2);
});
test("RU failures cannot fake a connected VPN and do not retry",async({page})=>{
  const pane=await open(page,{language:"ru",fail:true});
  await expect(pane).toContainText("Подключён").toHaveCount(0);
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
