import {test,expect} from "@playwright/test";

// Runs only within the disposable Guacamole/xrdp CI stack. Unlike the
// mock-only contracts, this exercises the real Guacamole client in Chromium
// against guacd's live RDP framebuffer through an HTTPS/WSS reverse proxy.
test.skip(process.env.NODEDESK_GUAC_LIVE!=="1","Requires isolated Guacamole lab");

test("live Guacamole RDP renders the xrdp framebuffer inside the NodeDesk tab",async({page})=>{
  test.setTimeout(120000);
  const user=process.env.QA_USER,password=process.env.QA_PASSWORD;
  expect(user).toBeTruthy();expect(password).toBeTruthy();
  await page.addInitScript(()=>{
    // Observe only Guacamole instruction names, never auth tokens, RDP
    // contents, usernames or WSS URLs. Proves actual user-input messages
    // travel from the in-tab viewer toward the real disposable gateway.
    window.__guacQaInput={key:0,mouse:0};
    const nativeSend=WebSocket.prototype.send;
    WebSocket.prototype.send=function(data){
      if(typeof data==="string"){
        const opcode=data.match(/^\\d+\\.(key|mouse),/);
        if(opcode)window.__guacQaInput[opcode[1]]++;
      }
      return nativeSend.call(this,data);
    };
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({
      version:1,groups:[],language:"en",theme:"dark",monitoring:false,
      connections:[{id:"qa-rdp",name:"Disposable RDP",host:"127.0.0.1",
        port:3389,username:"",protocol:"RDP",groupId:null,favorite:false}]
    }));
    window.__TAURI__={};window.isTauri=true;
    window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback(){},
      async invoke(){throw new Error("No native launch expected");}};
  });
  await page.goto("/");
  await page.locator(".connection-open").filter({hasText:"Disposable RDP"}).dblclick();
  const embedded=page.getByRole("region",{name:"Embedded RDP"});
  await embedded.getByRole("textbox",{name:"Guacamole HTTPS URL"})
    .fill("https://localhost:8443/guacamole/");
  await embedded.getByRole("textbox",{name:"Guacamole username"}).fill(user);
  await embedded.getByRole("textbox",{name:"Guacamole password"}).fill(password);
  await embedded.getByRole("checkbox").check();
  await embedded.getByRole("button",{name:"Sign in to Guacamole"}).click();
  await expect(embedded.getByRole("combobox",{name:"Authorized RDP connection"}))
    .toContainText("NodeDesk QA xrdp",{timeout:30000});
  await embedded.getByRole("button",{name:"Connect embedded"}).click();
  await expect(embedded.getByRole("status")).toContainText("Guacamole stream connected",
    {timeout:45000});
  const screen=embedded.getByLabel("RDP remote screen");
  await expect(screen.locator("canvas").first()).toBeVisible({timeout:30000});
  const dimensions=await screen.locator("canvas").first().evaluate(canvas=>({
    width:canvas.width,height:canvas.height
  }));
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.height).toBeGreaterThan(0);
  // Exercise mouse/keyboard against an isolated disposable Linux xrdp
  // server. Do not send inputs to any production host in this fixture.
  await screen.locator("canvas").first().click({position:{x:4,y:4}});
  await page.keyboard.press("a");
  await expect.poll(()=>page.evaluate(()=>window.__guacQaInput.mouse),{timeout:10000})
    .toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.__guacQaInput.key),{timeout:10000})
    .toBeGreaterThan(0);
  await embedded.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(embedded.getByRole("button",{name:"Connect embedded"})).toBeVisible();
  await embedded.getByRole("button",{name:"Sign out"}).click();
  await expect(embedded.getByRole("button",{name:"Sign in to Guacamole"})).toBeVisible();
});
