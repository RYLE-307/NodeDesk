import { test, expect } from '@playwright/test';

// UI contract tests only. The real sshd fixture separately proves authentication
// and SFTP bytes. This mock is never included in the application bundle.
async function open(page, language='en') {
  await page.addInitScript(({language}) => {
    localStorage.setItem('nodedesk.catalog.v1',JSON.stringify({version:1,groups:[],connections:[{id:'test',name:'Fixture',host:'localhost',port:22229,username:'fixture',protocol:'SSH',groupId:null,favorite:false}],language,theme:'dark',monitoring:false}));
    window.__TAURI__ = {};
    window.isTauri = true;
    window.fixture = {ready:false,calls:[],session:null,emptyRemote:false,allowTransfer:false};
    let next=0; const callbacks=new Map();
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {callbacks.set(++next,callback); return next;},
      unregisterCallback(id) {callbacks.delete(id);},
      async invoke(cmd,args) {
        // Never record terminal input, even in this test harness.
        window.fixture.calls.push({cmd,id:args?.id,destination:args?.destination,request:cmd==='files_mutate'?args?.request:undefined});
        if (cmd==='ssh_connect') {window.fixture.session=args.id; return;}
        if (cmd==='files_auth_ready') return window.fixture.ready;
        if (cmd==='ssh_disconnect') {window.fixture.ready=false; window.fixture.session=null; return;}
        if (cmd==='files_list') return {path:args.destination ? '/remote' : '/local',
          entries:args.destination && window.fixture.emptyRemote ? [] :
            [{name:'sample.bin',kind:'file',size:128,modified:null,permissions:384}]};
        if (cmd==='files_transfer') {
          if (window.fixture.allowTransfer) return;
          throw new Error('Unexpected transfer without confirmation/collision checks');
        }
      },
    };
  },{language});
  await page.goto('/');
  await page.getByRole('button',{name:/Fixture SSH/}).dblclick();
  await page.getByRole('tab',{name:language==='en'?'Files':'Файлы',exact:true}).click();
  return page.getByRole('region',{name:language==='en'?'SFTP file manager':'Файловый менеджер SFTP'});
}

test('no automatic connections; local works before login; remote waits for authentication',async({page}) => {
  const files=await open(page);
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='ssh_connect'))).toHaveLength(0);
  await files.getByRole('region',{name:'Local filesystem',exact:true}).getByRole('button',{name:'Open / refresh'}).click();
  await expect(files.getByText('/local',{exact:true})).toBeVisible();
  await page.setViewportSize({width:1000,height:700});
  const localEntry=files.getByRole('region',{name:'Local filesystem',exact:true}).getByRole('button',{name:'sample.bin',exact:true});
  await localEntry.scrollIntoViewIfNeeded(); await expect(localEntry).toBeInViewport();
  await files.getByRole('region',{name:'Remote filesystem',exact:true}).getByRole('button',{name:'Open / refresh'}).click();
  await expect(files.getByRole('alert')).toContainText('Complete Files login first');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&c.destination))).toHaveLength(0);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await expect(files.getByText('Waiting for login',{exact:true})).toBeVisible();
  await page.evaluate(()=>{window.fixture.ready=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  await files.getByRole('region',{name:'Remote filesystem',exact:true}).getByRole('button',{name:'Open / refresh'}).click();
  await expect(files.getByText('/remote',{exact:true})).toBeVisible();
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&c.destination));
  expect(calls[0].destination.authSession).toBeTruthy();
  await files.getByRole('button',{name:'Disconnect / cancel'}).click();
  await expect(files.getByText('/remote',{exact:true})).toHaveCount(0);
  await expect(files.getByRole('button',{name:'Upload → remote'})).toBeDisabled();
});

test('collision is rejected before confirmation or transfer; closing tab disconnects login',async({page}) => {
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  for (const name of ['Local filesystem','Remote filesystem']) await files.getByRole('region',{name,exact:true}).getByRole('button',{name:'Open / refresh'}).click();
  await files.getByRole('region',{name:'Local filesystem',exact:true}).getByRole('button',{name:'sample.bin',exact:true}).click();
  await files.getByRole('button',{name:'Upload → remote'}).click();
  await expect(files.getByRole('alert')).toContainText('Overwrite is disabled');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer'))).toHaveLength(0);
  // Closing the entire connection, not merely hiding the Files tool.
  await page.locator('.tab').getByRole('button').last().click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.some(c=>c.cmd==='ssh_disconnect'))).toBe(true);
});

for (const language of ['ru','en']) test(`visible two-pane layout and preserved consoles: ${language}`,async({page}) => {
  const files=await open(page,language);
  const box=await files.locator('.files-login .ssh-screen').boundingBox();
  expect(box.height).toBeLessThanOrEqual(130);
  const panes=files.locator('.files-panel'); await expect(panes).toHaveCount(2);
  for (const pane of await panes.all()) {const rect=await pane.boundingBox(); expect(rect.y).toBeLessThan(950); expect(rect.width).toBeGreaterThan(100);}
  await page.getByRole('tab',{name:'SSH',exact:true}).click();
  await expect(page.locator('.ssh-tool-panel:not([hidden]) .ssh-screen')).toBeVisible();
  await page.getByRole('tab',{name:'SFTP',exact:true}).click();
  await expect(page.locator('.ssh-tool-panel:not([hidden]) .ssh-screen')).toBeVisible();
  const theme=page.getByRole('combobox',{name:language==='en'?'Theme':'Тема',exact:true});
  await theme.selectOption('light'); await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await theme.selectOption('dark'); await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});

test('CRUD confirmations and no-overwrite are gated in GUI; no network before login',async({page}) => {
  const files=await open(page);
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  // Local mkdir works while remote Files authentication is not ready.
  page.once('dialog', dialog => dialog.accept('Safe folder'));
  await files.getByRole('region',{name:'Local filesystem',exact:true}).getByRole('button',{name:'Open / refresh'}).click();
  await files.getByRole('region',{name:'Local filesystem',exact:true}).getByRole('button',{name:'New folder'}).click();
  const localCalls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'));
  expect(localCalls).toHaveLength(1);
  expect(localCalls[0].request).toMatchObject({action:'mkdir',name:'Safe folder',destination:null});
  await remote.getByRole('button',{name:'New folder'}).click({force:true}).catch(()=>{});
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'))).toHaveLength(1);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  page.once('dialog', dialog => dialog.accept('Folder with spaces'));
  await remote.getByRole('button',{name:'New folder'}).click();
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'));
  expect(calls[1].request).toMatchObject({action:'mkdir',name:'Folder with spaces',directory:'/remote'});
  expect(calls[1].request.destination.authSession).toBeTruthy();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'sample.bin'}).click();
  page.once('dialog', dialog=>dialog.accept('sample-renamed.bin'));
  await remote.getByRole('button',{name:'Rename'}).click();
  const renames=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'&&c.request?.action==='rename'));
  expect(renames).toHaveLength(1);
  expect(renames[0].request).toMatchObject({name:'sample.bin',newName:'sample-renamed.bin',expectedKind:'file'});
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'sample.bin'}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await remote.getByRole('button',{name:'Delete'}).click();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'&&c.request?.action==='delete'))).toHaveLength(0);
  page.once('dialog',dialog=>dialog.accept());
  await remote.getByRole('button',{name:'Delete'}).click();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'&&c.request?.action==='delete'))).toHaveLength(1);
});

test('internal drag/drop cannot bypass duplicate-name guard',async({page}) => {
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('row').filter({hasText:'sample.bin'}).dragTo(remote);
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer'))).toHaveLength(0);
  await expect(files.getByRole('alert')).toContainText('Overwrite is disabled');
});

test('right click and keyboard context menu are non-destructive until confirmed',async({page}) => {
  const files=await open(page);
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  const row=local.getByRole('row').filter({hasText:'sample.bin'});
  await row.click({button:'right'});
  const menu=page.getByRole('menu',{name:'File actions'});
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem',{name:'Open folder'})).toBeDisabled();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'))).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await row.focus();
  await row.press('Shift+F10');
  await expect(menu).toBeVisible();
  page.once('dialog',dialog=>dialog.accept('renamed-from-menu.bin'));
  await menu.getByRole('menuitem',{name:'Rename'}).click();
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'));
  expect(calls).toHaveLength(1);
  expect(calls[0].request).toMatchObject({
    action:'rename',name:'sample.bin',newName:'renamed-from-menu.bin',expectedKind:'file',destination:null,
  });
});

test('successful upload and mutation refresh only their destination panes',async({page}) => {
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;window.fixture.emptyRemote=true;window.fixture.allowTransfer=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('button',{name:'sample.bin',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await files.getByRole('button',{name:'Upload → remote'}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&c.destination).length)).toBe(2);
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer'))).toHaveLength(1);
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&!c.destination))).toHaveLength(1);
  page.once('dialog',dialog=>dialog.accept('new-dir'));
  await remote.getByRole('button',{name:'New folder'}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&c.destination).length)).toBe(3);
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'&&c.request?.action==='mkdir'))).toHaveLength(1);
});

test('file search is independent per pane and clears hidden selection',async({page}) => {
  const files=await open(page);
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('button',{name:'sample.bin',exact:true}).click();
  const search=local.getByRole('searchbox',{name:'Local filesystem: search files'});
  await search.fill('not-present');
  await expect(local.getByText('No matches')).toBeVisible();
  await expect(local.getByRole('button',{name:'sample.bin',exact:true})).toHaveCount(0);
  await expect(files.getByRole('button',{name:'Upload → remote'})).toBeDisabled();
  await search.fill('SAMPLE');
  await expect(local.getByRole('button',{name:'sample.bin',exact:true})).toBeVisible();
  await expect(local.getByRole('button',{name:'sample.bin',exact:true})).toHaveAttribute('aria-pressed','false');
});
