import {readFileSync} from "node:fs";
import {test,expect} from "@playwright/test";

test.skip(process.env.NODEDESK_VNC_LIVE!=="1","Requires disposable VNC lab");

test("trusted WSS VNC authenticates and paints terminal pixels in the NodeDesk tab",async({page})=>{
  test.setTimeout(90000);
  const password=readFileSync("tests/vnc-lab/generated/vnc-password","utf8").trim();
  expect(password).toHaveLength(8);
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],language:"en",theme:"dark",monitoring:false,
      connections:[{id:"qa-vnc",name:"Disposable VNC",host:"127.0.0.1",
        port:5900,username:"",protocol:"VNC",groupId:null,favorite:false}]
    }));
    window.__TAURI__={};window.isTauri=true;
    window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback(){},
      async invoke(){throw new Error("No native launch expected");}};
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Disposable VNC"}).dblclick();
  const viewer=page.locator(".vnc-embedded");
  await viewer.getByRole("textbox",{name:"WSS endpoint"}).fill("wss://localhost:8444/rfb");
  await viewer.getByRole("button",{name:"Connect embedded"}).click();
  await expect(viewer.getByRole("textbox",{name:"VNC password"})).toBeVisible({timeout:30000});
  await viewer.getByRole("textbox",{name:"VNC password"}).fill(password);
  await viewer.getByRole("button",{name:"Authenticate"}).click();
  await expect(viewer.getByRole("status")).toContainText("VNC connected",{timeout:30000});
  const canvas=viewer.locator(".vnc-embedded-surface canvas").first();
  await expect(canvas).toBeVisible();
  await expect.poll(()=>canvas.evaluate(c=>{
    if(!c.width||!c.height)return `empty canvas ${c.width}x${c.height}`;
    const d=c.getContext("2d",{willReadFrequently:true})?.getImageData(0,0,c.width,c.height).data;
    if(!d)return "no 2D pixels";
    let nonblack=0;
    let light=0;
    for(let i=0;i<d.length;i+=4){
      if(d[i+3]>0){
        if(d[i]||d[i+1]||d[i+2])nonblack++;
        if(d[i]>180&&d[i+1]>180&&d[i+2]>180)light++;
      }
    }
    if(light>1000)return "light terminal pixels";
    const middle=Math.floor(c.height/2)*c.width+Math.floor(c.width/2);
    return `canvas ${c.width}x${c.height}, nonblack=${nonblack}, light=${light}, center=${[...d.slice(middle*4,middle*4+4)]}`;
  }),{timeout:30000}).toBe("light terminal pixels");
  await viewer.getByRole("checkbox",{name:"View only"}).check();
  await viewer.getByRole("checkbox",{name:"View only"}).uncheck();
  await viewer.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(viewer.getByRole("button",{name:"Connect embedded"})).toBeVisible();
});

