import {test,expect} from "@playwright/test";

const data=()=>({
  version:1,groups:[{id:"ops",name:"Operations",parentId:null}],
  connections:[
    {id:"ssh",name:"SSH lab",host:"ssh.example.test",port:22,username:"ops",protocol:"SSH",groupId:null,favorite:false},
    {id:"rdp",name:"RDP lab",host:"rdp.example.test",port:3389,username:"ops",protocol:"RDP",groupId:null,favorite:false},
    {id:"vnc",name:"VNC lab",host:"vnc.example.test",port:5900,username:"",protocol:"VNC",groupId:null,favorite:false},
  ],
  language:"en",theme:"dark",monitoring:false,
});
test("bulk move and favorite edit only selected rows with explicit consent",async({page})=>{
  await page.addInitScript(value=>localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value)),data());
  await page.goto("/");
  const bulk=page.getByRole("button",{name:"Bulk edit"});
  await bulk.click();
  await page.getByRole("checkbox",{name:"Select connection: SSH lab"}).check();
  await page.getByRole("checkbox",{name:"Select connection: RDP lab"}).check();
  await page.getByRole("combobox",{name:"Destination group"}).selectOption("ops");
  const original=await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"));
  page.once("dialog",d=>d.dismiss());
  await page.getByRole("button",{name:"Move selected"}).click();
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(original);
  page.once("dialog",d=>{expect(d.message()).toContain("(2)");d.accept();});
  await page.getByRole("button",{name:"Move selected"}).click();
  await expect(page.getByRole("status").last()).toContainText("Bulk update saved");
  let result=JSON.parse(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1")));
  expect(result.connections.map(c=>c.groupId)).toEqual(["ops","ops",null]);
  expect(result.connections.map(c=>c.id)).toEqual(["ssh","rdp","vnc"]);
  expect(result.connections[0].host).toBe("ssh.example.test");
  expect(result.connections[1].port).toBe(3389);
  await page.getByRole("checkbox",{name:"Select connection: SSH lab"}).check();
  page.once("dialog",d=>d.accept());
  await page.getByRole("button",{name:"Favorite selected",exact:true}).click();
  await expect(page.getByRole("status").last()).toContainText("Bulk update saved");
  result=JSON.parse(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1")));
  expect(result.connections.map(c=>c.favorite)).toEqual([true,false,false]);
  expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual(["nodedesk.catalog.v1"]);
});
test("bulk mode does not connect, clears selection on exit and keeps canceled changes intact",async({page})=>{
  await page.addInitScript(value=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify(value));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={
      transformCallback(){return 1;},unregisterCallback(){},
      async invoke(command){window.calls.push(command);}
    };
  },data());
  await page.goto("/");
  const bulk=page.getByRole("button",{name:"Bulk edit"});
  await bulk.click();
  await page.getByRole("checkbox",{name:"Select connection: SSH lab"}).check();
  const before=await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"));
  await bulk.click();
  await bulk.click();
  await expect(page.getByRole("button",{name:"Move selected"})).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem("nodedesk.catalog.v1"))).toBe(before);
  expect(await page.evaluate(()=>window.calls.filter(c=>c.startsWith("ssh_")||c.startsWith("rdp_")||c.startsWith("vnc_")))).toEqual([]);
});
