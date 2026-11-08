import {test,expect} from "@playwright/test";

test("local monitoring samples only after opt-in and stops after opt-out",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("nodedesk.catalog.v1",JSON.stringify({version:1,groups:[],connections:[],language:"en",theme:"dark",monitoring:false}));
    window.__TAURI__={};window.isTauri=true;window.calls=[];
    window.__TAURI_INTERNALS__={transformCallback(){return 1;},unregisterCallback(){},
      async invoke(cmd){window.calls.push(cmd);if(cmd!=="monitor_snapshot")throw Error("Unexpected command");
        return {cpuPercent:25,memoryUsedBytes:1073741824,memoryTotalBytes:4294967296,diskUsedBytes:2147483648,diskTotalBytes:8589934592,networkReceivedBytes:1073741824,networkTransmittedBytes:536870912};}}
  });
  await page.goto("/");
  expect(await page.evaluate(()=>window.calls)).toEqual([]);
  await page.getByRole("checkbox",{name:"Monitoring"}).check();
  const panel=page.getByRole("region",{name:"Local monitoring"});
  await expect(panel).toContainText("CPU 25%");
  await expect(panel).toContainText("Memory 1.0 GiB / 4.0 GiB");
  expect(await page.evaluate(()=>window.calls)).toEqual(expect.arrayContaining(["monitor_snapshot"]));
  expect(await page.evaluate(()=>window.calls.every(cmd=>cmd==="monitor_snapshot"))).toBe(true);
  await page.getByRole("checkbox",{name:"Monitoring"}).uncheck();
  await expect(panel).toHaveCount(0);
  const count=await page.evaluate(()=>window.calls.length);
  await page.waitForTimeout(3200);
  expect(await page.evaluate(()=>window.calls.length)).toBe(count);
});
