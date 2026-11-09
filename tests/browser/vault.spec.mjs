import {test,expect} from "@playwright/test";

const ID="123e4567-e89b-12d3-a456-426614174000";
test("OS vault locks by default, stores no WebView secret and binds the saved target",async({page})=>{
  await page.addInitScript(({id})=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],
      connections:[{id,name:"Disposable SSH",host:"127.0.0.1",port:22229,
        username:"fixture",protocol:"SSH",groupId:null,favorite:false}],
      language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;
    window.fixture={open:false,record:null,calls:[]};
    let next=0;
    window.__TAURI_INTERNALS__={transformCallback(){return ++next;},unregisterCallback(){},
      async invoke(cmd,args){
        window.fixture.calls.push({cmd,target:args?.target});
        const f=window.fixture;
        if(cmd==="vault_status")return f.open;
        if(cmd==="vault_unlock"){f.open=true;return;}
        if(cmd==="vault_lock"){f.open=false;return;}
        if(!f.open)throw Error("Vault is locked");
        if(cmd==="vault_has")return !!f.record;
        if(cmd==="vault_put"){f.record={target:args.target,secret:args.secret};return;}
        if(cmd==="vault_get")return f.record?.secret??null;
        if(cmd==="vault_delete"){f.record=null;return;}
        throw Error("Unexpected command: "+cmd);
      }};
  },{id:ID});
  await page.goto("/");
  await page.locator(".catalog-tools").getByRole("button",{name:"Credential vault"}).click();
  const vault=page.getByRole("region",{name:"Credential vault"});
  await expect(vault).toBeVisible();
  await expect(vault.getByRole("button",{name:"Lock",exact:true})).toBeDisabled();
  await vault.getByRole("button",{name:"Unlock"}).click();
  await vault.getByRole("combobox",{name:"Credential connection"}).selectOption(ID);
  await expect(vault).toContainText("No saved credential");
  await vault.getByLabel("New credential").fill("fixture-private-password");
  await vault.getByRole("button",{name:"Save in OS store"}).click();
  await expect(vault).toContainText("Credential saved");
  expect(await page.evaluate(()=>Object.values(localStorage).join(" "))).not.toContain("fixture-private-password");
  const record=await page.evaluate(()=>window.fixture.record);
  expect(record).toEqual({target:{id:ID,protocol:"SSH",host:"127.0.0.1",port:22229,
    username:"fixture"},secret:"fixture-private-password"});
  await vault.getByRole("button",{name:"Lock",exact:true}).click();
  await expect(vault.getByRole("button",{name:"Save in OS store"})).toHaveCount(0);
  expect(await page.evaluate(()=>Object.values(localStorage).join(" "))).not.toContain("fixture-private-password");
  await vault.getByRole("button",{name:"Unlock"}).click();
  await expect(vault).toContainText("Credential saved");
  page.once("dialog",dialog=>dialog.accept());
  await vault.getByRole("button",{name:"Delete credential"}).click();
  await expect(vault).toContainText("No saved credential");
});
