import {test} from "node:test";
import assert from "node:assert/strict";
import {guacBase,parseGuacAuth,parseRdpConnections,guacTunnelQuery,guacWssTunnel,guacLogin,guacConnections} from "../src/guacamoleAuth.ts";

const result={authToken:"fixture-session-token",dataSource:"postgresql",
  availableDataSources:["postgresql","ldap"]};
const rdp={id:"42",name:"Disposable Windows",source:"postgresql",protocol:"rdp"};

test("Guacamole API base URL requires HTTPS without userinfo, query or fragment",()=>{
  assert.equal(guacBase("https://guac.example.org/guacamole"),
    "https://guac.example.org/guacamole/");
  assert.equal(guacWssTunnel("https://guac.example.org/guacamole/"),
    "wss://guac.example.org/guacamole/websocket-tunnel");
  for(const url of ["","http://host/","ws://host/","wss://host/","HTTPS://host/",
    "https://admin:password@host/guac","https://host/guac?token=abc",
    "https://host/guac#secret","https://host/%2fsecret","https://host/%2e%2e/",
    " https://host/","https://host/\n"])assert.throws(()=>guacBase(url),undefined,url);
});
test("Guacamole authentication result and sources are validated",()=>{
  assert.deepEqual(parseGuacAuth(result),result);
  assert.throws(()=>parseGuacAuth({...result,authToken:"a\nb"}));
  assert.throws(()=>parseGuacAuth({...result,availableDataSources:["../admin"]}));
  assert.throws(()=>parseGuacAuth({...result,dataSource:""}));
});
test("only server-authorized RDP connection entries are selectable",()=>{
  const list=parseRdpConnections({
    42:{identifier:"42",name:"Disposable Windows",protocol:"rdp"},
    23:{identifier:"23",name:"VNC machine",protocol:"vnc"},
    55:{identifier:"55",name:"Invalid control\nlabel",protocol:"rdp"},
    91:{identifier:"../evil",name:"Invalid",protocol:"rdp"}
  },"postgresql");
  assert.deepEqual(list,[rdp]);
  assert.throws(()=>parseRdpConnections([rdp],"postgresql"));
});
test("tunnel request carries only the Guacamole protocol fields and validated IDs",()=>{
  const params=new URLSearchParams(guacTunnelQuery(result.authToken,rdp,1280,720));
  assert.equal(params.get("token"),result.authToken);
  assert.equal(params.get("GUAC_ID"),"42");
  assert.equal(params.get("GUAC_TYPE"),"c");
  assert.equal(params.get("GUAC_DATA_SOURCE"),"postgresql");
  assert.equal(params.get("GUAC_WIDTH"),"1280");
  assert.equal(params.get("GUAC_HEIGHT"),"720");
  assert.equal(params.get("GUAC_DPI"),"96");
  assert.equal(params.has("username"),false);
  assert.equal(params.has("password"),false);
  assert.throws(()=>guacTunnelQuery(result.authToken,{...rdp,id:"../../admin"},800,600));
  assert.throws(()=>guacTunnelQuery(result.authToken,rdp,0,600));
});
test("Guacamole standard login and connection listing use controlled HTTPS fetch",async()=>{
  const prior=globalThis.fetch, calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith("/api/tokens")){
      return {ok:true,json:async()=>result};
    }
    if(String(url).includes("/postgresql/connections?")){
      return {ok:true,json:async()=>({
        42:{identifier:"42",name:"Disposable Windows",protocol:"rdp"},
        8:{identifier:"8",name:"Other VNC",protocol:"vnc"}
      })};
    }
    return {ok:false,status:403};
  };
  try{
    const auth=await guacLogin("https://guac.example.org/guacamole/","qa-user","fake-fixture-password");
    const available=await guacConnections("https://guac.example.org/guacamole/",auth);
    assert.deepEqual(available,[rdp]);
    assert.equal(calls[0].options.method,"POST");
    assert.equal(calls[0].options.redirect,"error");
    assert.equal(calls[0].options.credentials,"omit");
    assert.equal(calls[0].options.body.get("username"),"qa-user");
    assert.equal(calls[0].options.body.get("password"),"fake-fixture-password");
    assert.ok(calls[1].url.includes("token=fixture-session-token"));
    assert.equal(calls[1].options.method,"GET");
    assert.equal(calls[1].options.cache,"no-store");
    assert.equal(calls[1].options.credentials,"omit");
  }finally{globalThis.fetch=prior;}
});
test("Guacamole login rejects empty password before a network request",async()=>{
  await assert.rejects(()=>guacLogin("https://guac.example/guacamole/","u",""));
});
