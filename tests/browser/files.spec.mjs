import { test, expect } from '@playwright/test';

// UI contract tests only. The real sshd fixture separately proves authentication
// and SFTP bytes. This mock is never included in the application bundle.
async function open(page, language='en', caps={interactiveLogin:true,keyAgent:true}) {
  await page.addInitScript(({language,caps}) => {
    localStorage.setItem('nodedesk.catalog.v1',JSON.stringify({version:1,groups:[],connections:[{id:'test',name:'Fixture',host:'localhost',port:22229,username:'fixture',protocol:'SSH',groupId:null,favorite:false}],language,theme:'dark',monitoring:false}));
    window.__TAURI__ = {};
    window.isTauri = true;
    window.fixture = {ready:false,calls:[],session:null,emptyRemote:false,allowTransfer:false,extraLocal:false,pauseTransfers:false,rejectPending:null,caps,changedSource:false,existingCopy:false,failOnNameOnce:null,collisionName:null,changedSourceMeta:false};
    let next=0; const callbacks=new Map();
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {callbacks.set(++next,callback); return next;},
      unregisterCallback(id) {callbacks.delete(id);},
      async invoke(cmd,args) {
        // Never record terminal input, even in this test harness.
        window.fixture.calls.push({
          cmd,id:args?.id,destination:args?.destination,
          request:cmd==='files_save_text_copy' ? {
            originalName:args.request.originalName,newName:args.request.newName,
            directory:args.request.directory,destination:args.request.destination,
            changed:args.request.content!==args.request.originalContent
          } : ['files_mutate','files_transfer','files_preview'].includes(cmd)?args?.request:undefined
        });
        if (cmd==='files_capabilities') return window.fixture.caps;
        if (cmd==='ssh_connect') {window.fixture.session=args.id; window.fixture.loginAuth=args.auth; return;}
        if (cmd==='files_auth_ready') return window.fixture.ready;
        if (cmd==='ssh_disconnect') {window.fixture.ready=false; window.fixture.session=null; return;}
        if (cmd==='files_cancel') {window.fixture.rejectPending?.(new Error('cancelled'));window.fixture.rejectPending=null;return;}
        if (cmd==='files_list') return {path:args.destination ? '/remote' : '/local',
          entries:args.destination && window.fixture.emptyRemote
            ? (window.fixture.collisionName ? [{name:window.fixture.collisionName,kind:'file',size:256,modified:null,permissions:384}] : []) :
            [
              {name:'sample.bin',kind:'file',size:128,modified:null,permissions:384},
              ...(!args.destination && window.fixture.extraLocal ? [{name:'extra.bin',kind:'file',size:window.fixture.changedSourceMeta?999:256,modified:null,permissions:384}] : [])
            ]};
        if (cmd==='files_preview') return {name:args.request.name,content:'Remote UTF-8: привет\\n<svg onload=alert(1)>',bytes:47};
        if(cmd==='files_save_text_copy'){
          if(window.fixture.changedSource)throw new Error('Original file changed since opening; copy was not created');
          if(window.fixture.existingCopy)throw new Error('SFTP status 4: destination already exists');
          return {name:args.request.newName,bytes:new TextEncoder().encode(args.request.content).length,sourceUnchanged:true};
        }
        if (cmd==='files_transfer') {
          if (window.fixture.allowTransfer) {
            if (window.fixture.failOnNameOnce===args.request.name) {
              window.fixture.failOnNameOnce=null;throw new Error('transient-test-error');
            }
            if (window.fixture.pauseTransfers) return new Promise((_,reject)=>{window.fixture.rejectPending=reject;});
            return;
          }
          throw new Error('Unexpected transfer without confirmation/collision checks');
        }
      },
    };
  },{language,caps});
  await page.goto('/');
  await page.getByRole('button',{name:/Fixture SSH/}).dblclick();
  await page.getByRole('tab',{name:language==='en'?'Files':'Файлы',exact:true}).click();
  const files=page.getByRole('region',{name:language==='en'?'SFTP file manager':'Файловый менеджер SFTP'});
  // Wait for the native capability command to resolve before interacting;
  // Windows has no OpenSSH ControlMaster bridge.
  const auth=files.getByRole('checkbox',{name:language==='en'?'Interactive Files login (password/PAM)':'Интерактивный вход для файлов (пароль/PAM)'});
  if (caps.interactiveLogin) await expect(auth).toBeChecked();
  else await expect(auth).toBeDisabled();
  return files;
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
  await expect(page.locator('.ssh-tool-panel:not([hidden]) .ssh-help')).toContainText(
    language==='en' ? 'For the graphical file manager, open the Files tab.' : 'Для графического управления файлами откройте вкладку «Файлы».'
  );
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

test('selected batch transfers two files sequentially, then refreshes remote only',async({page}) => {
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;window.fixture.emptyRemote=true;window.fixture.extraLocal=true;window.fixture.allowTransfer=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('checkbox',{name:'Select for transfer: sample.bin'}).check();
  await local.getByRole('checkbox',{name:'Select for transfer: extra.bin'}).check();
  page.once('dialog',dialog=>dialog.accept());
  await files.getByRole('button',{name:'Upload selected (2)'}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(2);
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').map(c=>c.request.name));
  expect(calls).toEqual(['sample.bin','extra.bin']);
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&c.destination).length)).toBe(2);
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&!c.destination).length)).toBe(1);
  await expect(local.getByRole('checkbox',{name:'Select for transfer: sample.bin'})).toBeChecked();
});
test('cancelling a blocked first transfer never starts queued files',async({page}) => {
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;window.fixture.emptyRemote=true;window.fixture.extraLocal=true;window.fixture.allowTransfer=true;window.fixture.pauseTransfers=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('checkbox',{name:'Select for transfer: sample.bin'}).check();
  await local.getByRole('checkbox',{name:'Select for transfer: extra.bin'}).check();
  page.once('dialog',dialog=>dialog.accept());
  await files.getByRole('button',{name:'Upload selected (2)'}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(1);
  await files.getByRole('button',{name:'Cancel operation'}).click();
  await expect(files.getByRole('button',{name:'Upload selected (2)'})).toBeEnabled();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(1);
});

test('completed batch shows per-file outcomes and correct progress label',async({page})=>{
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;window.fixture.emptyRemote=true;window.fixture.extraLocal=true;window.fixture.allowTransfer=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('checkbox',{name:'Select for transfer: sample.bin'}).check();
  await local.getByRole('checkbox',{name:'Select for transfer: extra.bin'}).check();
  page.once('dialog',dialog=>dialog.accept());
  await files.getByRole('button',{name:'Upload selected (2)'}).click();
  const report=files.getByRole('region',{name:'Transfer report'});
  await expect(report).toContainText('File transfers: 2/2');
  await expect(report.getByRole('listitem')).toHaveCount(2);
  await expect(report.getByRole('listitem').first()).toContainText('Done');
  await expect(report.getByRole('listitem').last()).toContainText('Done');
  await report.getByRole('button',{name:'Clear report'}).click();
  await expect(report).not.toBeVisible();
});

test('cancelled batch reports not-started files, rather than pretending success',async({page})=>{
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;window.fixture.emptyRemote=true;window.fixture.extraLocal=true;window.fixture.allowTransfer=true;window.fixture.pauseTransfers=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('checkbox',{name:'Select for transfer: sample.bin'}).check();
  await local.getByRole('checkbox',{name:'Select for transfer: extra.bin'}).check();
  page.once('dialog',dialog=>dialog.accept());
  await files.getByRole('button',{name:'Upload selected (2)'}).click();
  await expect(files.getByRole('status').filter({hasText:'Queue: 1/2'})).toBeVisible();
  await files.getByRole('button',{name:'Cancel operation'}).click();
  const report=files.getByRole('region',{name:'Transfer report'});
  await expect(report).toContainText('File transfers: 0/2');
  await expect(report.getByRole('listitem').first()).toContainText('Cancelled');
  await expect(report.getByRole('listitem').last()).toContainText('Not started');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(1);
});

test('select visible limits to regular files and multi-drag reuses batch confirmation',async({page})=>{
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{window.fixture.ready=true;window.fixture.emptyRemote=true;window.fixture.extraLocal=true;window.fixture.allowTransfer=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('button',{name:'Select visible (up to 50)'}).click();
  await expect(local.getByRole('checkbox',{name:'Select for transfer: sample.bin'})).toBeChecked();
  await expect(local.getByRole('checkbox',{name:'Select for transfer: extra.bin'})).toBeChecked();
  page.once('dialog',dialog=>dialog.accept());
  await local.getByRole('row').filter({hasText:'sample.bin'}).dragTo(remote);
  await expect.poll(()=>page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(2);
  const names=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').map(c=>c.request.name));
  expect(names).toEqual(['extra.bin','sample.bin']);
  await expect(files.getByRole('region',{name:'Transfer report'})).toContainText('File transfers: 2/2');
});

test('unsupported-platform capability fails closed to key/agent',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:false,keyAgent:true});
  const checkbox=files.getByRole('checkbox',{name:'Interactive Files login (password/PAM)'});
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  await expect(files.getByText('GUI password/PAM is not available on this platform yet.',{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='ssh_connect'))).toHaveLength(0);
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&c.destination));
  expect(calls).toHaveLength(1);
  expect(calls[0].destination.authSession).toBeNull();
});
test('missing capability command fails closed and leaves no interactive login',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:false,keyAgent:false});
  const checkbox=files.getByRole('checkbox',{name:'Interactive Files login (password/PAM)'});
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='ssh_connect'))).toHaveLength(0);
});

test('Windows native login offers password/PAM, gates remote access and clears listing on disconnect',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:true,keyAgent:true,nativeLogin:true});
  const method=files.getByRole('combobox',{name:'SSH authentication method'});
  await expect(method).toHaveValue('password');
  await expect(method.locator('option[value=key]')).toBeDisabled();
  await expect(files.getByText('Cancelling a transfer closes the Files session',{exact:false})).toBeVisible();
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_list'&&c.destination))).toHaveLength(0);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  expect(await page.evaluate(()=>window.fixture.loginAuth)).toBe('password');
  await page.evaluate(()=>{window.fixture.ready=true;});
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await expect(files.getByText('/remote',{exact:true})).toBeVisible();
  await files.getByRole('button',{name:'Disconnect / cancel'}).click();
  await expect(files.getByText('/remote',{exact:true})).toHaveCount(0);
  await expect(files.getByText('Waiting for login',{exact:true})).toBeVisible();
});


test('read-only SFTP preview is opt-in, session-scoped and text-only',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:false,keyAgent:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await expect(remote.getByRole('button',{name:'sample.bin',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_preview'))).toHaveLength(0);
  await remote.getByRole('button',{name:'sample.bin',exact:true}).click();
  await remote.getByRole('button',{name:'Preview text',exact:true}).click();
  const preview=files.getByRole('region',{name:'Remote text editor'});
  await expect(preview).toContainText('Remote UTF-8: привет');
  await expect(preview).toContainText('<svg onload=alert(1)>');
  await expect(preview.locator('svg')).toHaveCount(0);
  const previews=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_preview'));
  expect(previews).toHaveLength(1);
  expect(previews[0].request).toMatchObject({
    name:'sample.bin',directory:'/remote',destination:{host:'localhost',port:22229,username:'fixture'}
  });
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'||c.cmd==='files_transfer'))).toHaveLength(0);
  await preview.getByRole('button',{name:'Close editor'}).click();
  await expect(preview).toHaveCount(0);
});


test('SFTP text editor saves only a distinct copy after explicit confirmation',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:false,keyAgent:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'sample.bin',exact:true}).click();
  await remote.getByRole('button',{name:'Preview text',exact:true}).click();
  const editor=files.getByRole('region',{name:'Remote text editor'});
  await editor.getByRole('button',{name:'Edit text'}).click();
  const draft=editor.getByRole('textbox',{name:'File text'});
  await draft.fill('Edited UTF-8: привет');
  const filename=editor.getByRole('textbox',{name:'New copy filename'});
  await filename.fill('sample.bin');
  await expect(editor.getByRole('button',{name:'Save as new copy'})).toBeDisabled();
  await filename.fill('sample-edited.txt');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_save_text_copy'))).toHaveLength(0);
  page.once('dialog',dialog=>dialog.accept());
  await editor.getByRole('button',{name:'Save as new copy'}).click();
  await expect(editor.getByText('Saved new copy: sample-edited.txt')).toBeVisible();
  const saves=await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_save_text_copy'));
  expect(saves).toHaveLength(1);
  expect(saves[0].request).toMatchObject({
    directory:'/remote',originalName:'sample.bin',newName:'sample-edited.txt',
    changed:true,destination:{host:'localhost',port:22229,username:'fixture'}
  });
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_mutate'||c.cmd==='files_transfer'))).toHaveLength(0);
  // Never insert remote text as executable HTML.
  expect(await editor.locator('svg').count()).toBe(0);
});

test('SFTP editor preserves unsaved edits and reports source conflicts',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:false,keyAgent:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'sample.bin',exact:true}).click();
  await remote.getByRole('button',{name:'Preview text',exact:true}).click();
  const editor=files.getByRole('region',{name:'Remote text editor'});
  await editor.getByRole('button',{name:'Edit text'}).click();
  await editor.getByRole('textbox',{name:'File text'}).fill('A new unsaved version');
  page.once('dialog',dialog=>dialog.dismiss());
  await editor.getByRole('button',{name:'Close editor'}).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('textbox',{name:'File text'})).toHaveValue('A new unsaved version');
  await page.evaluate(()=>{window.fixture.changedSource=true;});
  await editor.getByRole('textbox',{name:'New copy filename'}).fill('new-version.txt');
  page.once('dialog',dialog=>dialog.accept());
  await editor.getByRole('button',{name:'Save as new copy'}).click();
  await expect(files.getByRole('alert')).toContainText('Original file changed since opening');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_save_text_copy'))).toHaveLength(1);
  await expect(editor.getByRole('textbox',{name:'File text'})).toHaveValue('A new unsaved version');
  page.once('dialog',dialog=>dialog.accept());
  await editor.getByRole('button',{name:'Close editor'}).click();
  await expect(editor).toHaveCount(0);
});


test('SFTP find is literal, selects UTF-8 text and replace selected stays local',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:false,keyAgent:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'sample.bin',exact:true}).click();
  await remote.getByRole('button',{name:'Preview text',exact:true}).click();
  const editor=files.getByRole('region',{name:'Remote text editor'});
  await editor.getByRole('button',{name:'Edit text'}).click();
  const search=editor.getByRole('group',{name:'Find and replace'});
  const area=editor.getByRole('textbox',{name:'File text'});
  await search.getByRole('searchbox',{name:'Find in text'}).fill('привет');
  await expect(search.getByRole('status',{name:'Matches'})).toContainText('1');
  await search.getByRole('button',{name:'Next match'}).click();
  expect(await area.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe('привет');
  await search.getByRole('textbox',{name:'Replacement text'}).fill('мир');
  await search.getByRole('button',{name:'Replace selected'}).click();
  await expect(area).toHaveValue(/Remote UTF-8: мир/);
  await expect(search.getByRole('status',{name:'Matches'})).toContainText('0');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_save_text_copy'))).toHaveLength(0);
  await editor.getByRole('button',{name:'Read-only view'}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await editor.getByRole('button',{name:'Close editor'}).click();
  await expect(editor).toBeVisible();
  await editor.getByRole('button',{name:'Edit text'}).click();
  await expect(editor.getByRole('textbox',{name:'File text'})).toHaveValue(/мир/);
  expect(await editor.locator('svg').count()).toBe(0);
});

test('SFTP replace-all is opt-in, bounded, literal and never auto-saves',async({page})=>{
  const files=await open(page,'en',{interactiveLogin:false,keyAgent:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'sample.bin',exact:true}).click();
  await remote.getByRole('button',{name:'Preview text',exact:true}).click();
  const editor=files.getByRole('region',{name:'Remote text editor'});
  await editor.getByRole('button',{name:'Edit text'}).click();
  const area=editor.getByRole('textbox',{name:'File text'});
  await area.fill('foo foo foo');
  const search=editor.getByRole('group',{name:'Find and replace'});
  await search.getByRole('searchbox',{name:'Find in text'}).fill('foo');
  await expect(search.getByRole('status',{name:'Matches'})).toContainText('3');
  await search.getByRole('textbox',{name:'Replacement text'}).fill('bar');
  page.once('dialog',dialog=>dialog.dismiss());
  await search.getByRole('button',{name:'Replace all…'}).click();
  await expect(area).toHaveValue('foo foo foo');
  page.once('dialog',dialog=>dialog.accept());
  await search.getByRole('button',{name:'Replace all…'}).click();
  await expect(area).toHaveValue('bar bar bar');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_save_text_copy'))).toHaveLength(0);
  await search.getByRole('searchbox',{name:'Find in text'}).fill('.');
  await expect(search.getByRole('status',{name:'Matches'})).toContainText('0');
  await search.getByRole('searchbox',{name:'Find in text'}).fill('bar');
  await search.getByRole('textbox',{name:'Replacement text'}).fill('\u0000');
  // Invalid replacement text must not mutate the editor (backend also validates).
  await search.getByRole('button',{name:'Replace selected'}).click();
  await expect(area).toHaveValue('bar bar bar');
});


test('retry unfinished SFTP batch requires both fresh listings and never repeats completed file',async({page})=>{
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{
    Object.assign(window.fixture,{ready:true,emptyRemote:true,extraLocal:true,
      allowTransfer:true,failOnNameOnce:'extra.bin'});
  });
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('checkbox',{name:'Select for transfer: sample.bin'}).check();
  await local.getByRole('checkbox',{name:'Select for transfer: extra.bin'}).check();
  page.once('dialog',dialog=>dialog.accept());
  await files.getByRole('button',{name:'Upload selected (2)'}).click();
  const report=files.getByRole('region',{name:'Transfer report'});
  await expect(report).toContainText('File transfers: 1/2');
  await expect(report.getByRole('listitem').first()).toContainText('Done');
  await expect(report.getByRole('listitem').last()).toContainText('Failed');
  const retry=report.getByRole('button',{name:'Retry unfinished'});
  await retry.click();
  await expect(files.getByRole('alert')).toContainText('Refresh BOTH filesystem panes before retry');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(2);
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await retry.click();
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(2);
  page.once('dialog',dialog=>dialog.accept());
  await retry.click();
  await expect(report).toContainText('File transfers: 2/2');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').map(c=>c.request.name)))
    .toEqual(['sample.bin','extra.bin','extra.bin']);
  await expect(report.getByRole('button',{name:'Retry unfinished'})).toHaveCount(0);
});

test('queue retry refuses destination collision and changed source metadata',async({page})=>{
  const files=await open(page);
  await files.getByRole('button',{name:'Connect / reconnect'}).click();
  await page.evaluate(()=>{
    Object.assign(window.fixture,{ready:true,emptyRemote:true,extraLocal:true,
      allowTransfer:true,failOnNameOnce:'extra.bin'});
  });
  await expect(files.getByText('Authenticated — panes ready',{exact:true})).toBeVisible();
  const local=files.getByRole('region',{name:'Local filesystem',exact:true});
  const remote=files.getByRole('region',{name:'Remote filesystem',exact:true});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await local.getByRole('checkbox',{name:'Select for transfer: sample.bin'}).check();
  await local.getByRole('checkbox',{name:'Select for transfer: extra.bin'}).check();
  page.once('dialog',dialog=>dialog.accept());
  await files.getByRole('button',{name:'Upload selected (2)'}).click();
  const report=files.getByRole('region',{name:'Transfer report'});
  await expect(report).toContainText('File transfers: 1/2');
  const retry=report.getByRole('button',{name:'Retry unfinished'});
  await page.evaluate(()=>{window.fixture.collisionName='extra.bin';});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await retry.click();
  await expect(files.getByRole('alert')).toContainText('overwrite is disabled');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(2);
  await page.evaluate(()=>{window.fixture.collisionName=null;window.fixture.changedSourceMeta=true;});
  await local.getByRole('button',{name:'Open / refresh'}).click();
  await remote.getByRole('button',{name:'Open / refresh'}).click();
  await retry.click();
  await expect(files.getByRole('alert')).toContainText('Source metadata changed');
  expect(await page.evaluate(()=>window.fixture.calls.filter(c=>c.cmd==='files_transfer').length)).toBe(2);
  await report.getByRole('button',{name:'Clear report'}).click();
  await expect(report).toHaveCount(0);
});
