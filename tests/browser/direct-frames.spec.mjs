import {test, expect} from '@playwright/test';

for (const protocol of ['RDP','VNC']) {
  test(protocol+' preserves frame order and ignores decode after disconnect',async({page})=>{
    await page.addInitScript(protocol=>{
      localStorage.setItem('nodedesk.catalog.v1',JSON.stringify({version:1,groups:[],connections:[{
        id:'123e4567-e89b-12d3-a456-426614174000',name:'Frame fixture',host:'fixture.example.test',
        port:protocol==='RDP'?3389:5900,username:'fixture',protocol,groupId:null,favorite:false,
      }],language:'en',theme:'dark',monitoring:false}));
      window.__TAURI__={};window.isTauri=true;
      window.frameFixture={calls:[],decodes:[]};
      const original=window.createImageBitmap.bind(window);
      window.createImageBitmap=blob=>new Promise((resolve,reject)=>{
        window.frameFixture.decodes.push(()=>original(blob).then(resolve,reject));
      });
      let index=0;
      window.__TAURI_INTERNALS__={transformCallback(){return ++index;},unregisterCallback(){},
        async invoke(cmd,args){window.frameFixture.calls.push({cmd,args});}};
    },protocol);
    await page.goto('/');
    await page.locator('.connection-open').filter({hasText:'Frame fixture'}).dblclick();
    const direct=page.getByRole('region',{name:'Direct '+protocol,exact:true});
    if(protocol==='VNC')await direct.getByLabel('Verified SHA256 SPKI fingerprint').fill('ab'.repeat(32));
    await direct.getByLabel(protocol+' password for this session').fill('fixture-only');
    await direct.getByRole('button',{name:'Connect directly'}).click();
    await page.evaluate(protocol=>{
      const fixture=window.frameFixture;
      const connect=fixture.calls.find(c=>c.cmd===protocol.toLowerCase()+'_direct_connect');
      fixture.send=event=>connect.args.events.onmessage(event);
      fixture.send({type:'status',phase:'connected'});
      if(protocol==='VNC')fixture.send({type:'resize',width:1,height:1});
      fixture.frame=color=>{
        const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
        const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
        fixture.send({type:'frame',x:0,y:0,width:1,height:1,png:canvas.toDataURL().split(',')[1]});
      };
      fixture.frame('#ff0000');fixture.frame('#0000ff');
    },protocol);
    await expect.poll(()=>page.evaluate(()=>window.frameFixture.decodes.length)).toBe(1);
    await page.evaluate(()=>window.frameFixture.decodes[0]());
    await expect.poll(()=>page.evaluate(()=>window.frameFixture.decodes.length)).toBe(2);
    await page.evaluate(()=>window.frameFixture.decodes[1]());
    const pixel=()=>direct.locator('canvas').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,1,1).data).slice(0,3));
    await expect.poll(pixel).toEqual([0,0,255]);
    await page.evaluate(()=>window.frameFixture.frame('#ff0000'));
    await expect.poll(()=>page.evaluate(()=>window.frameFixture.decodes.length)).toBe(3);
    await direct.getByRole('button',{name:'Disconnect'}).click();
    await page.evaluate(()=>window.frameFixture.decodes[2]());
    await expect.poll(pixel).toEqual([0,0,255]);
  });
}
