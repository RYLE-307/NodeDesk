import {strict as assert} from "node:assert";
import {setTimeout as sleep} from "node:timers/promises";
import {setDefaultResultOrder} from "node:dns";
setDefaultResultOrder("ipv4first"); // Docker exposes localhost only on 127.0.0.1
import {
  guacLogin,guacConnections,guacLogout,guacTunnelQuery,guacWssTunnel
} from "../../src/guacamoleAuth.ts";

const base="https://localhost:8443/guacamole/";
const user=process.env.QA_USER;
const password=process.env.QA_PASSWORD;
if(!user||!password||!process.env.NODE_EXTRA_CA_CERTS){
  throw new Error("Missing QA credentials or trusted lab CA (see README).");
}
const timeoutMs=45000;

async function waitForServer(){
  let lastStatus="none",lastCode="none";
  for(let attempt=0;attempt<90;attempt++){
    try{
      const res=await fetch(new URL("api/tokens",base),{method:"GET",redirect:"error"});
      lastStatus=String(res.status);
      if(res.status<500)return;
    }catch(e){
      // Diagnostic code only; never log credentials, HTTP bodies or tokens.
      lastCode=String(e?.cause?.code||e?.name||"unknown");
    }
    await sleep(1000);
  }
  throw new Error("Guacamole HTTPS readiness failed: HTTP "+lastStatus+"; TLS/network "+lastCode);
}

function assertGuacamoleSession(url){
  return new Promise((resolve,reject)=>{
    // Node 24's builtin WebSocket uses NODE_EXTRA_CA_CERTS to validate
    // the disposable test CA; no insecure TLS verification overrides.
    const socket=new WebSocket(url,"guacamole");
    let ready=false,frame=false,done=false;
    const seen=[];
    const timer=setTimeout(()=>finish(new Error("Guacamole RDP session did not produce a framebuffer handshake")),timeoutMs);
    function finish(err){
      if(done)return;
      done=true;clearTimeout(timer);
      try{socket.close();}catch{/* already closed */}
      if(err)reject(err);else resolve({ready,frame});
    }
    socket.addEventListener("error",()=>finish(new Error("Guacamole WSS connection failed")));
    socket.addEventListener("close",event=>finish(new Error(
      "Guacamole WSS closed before framebuffer handshake; close="+
      event.code+"; instructions="+seen.join(","))));
    socket.addEventListener("message",event=>{
      const chunk=String(event.data);
      // Record only Guacamole instruction opcodes, never argument bodies,
      // usernames, the tunnel auth token or remote error descriptions.
      for(const match of chunk.matchAll(/(?:^|;)\\d+\\.([a-z]+)(?:,|;)/g)){
        if(seen.length<20)seen.push(match[1]);
      }
      if(chunk.includes("5.ready,"))ready=true;
      if(chunk.includes("4.size,")||chunk.includes("4.sync,")||chunk.includes("3.img,"))frame=true;
      // The first server sync may require a client acknowledgement before
      // the next framebuffer update. Send only an echoed timestamp, never
      // credentials or arbitrary text from the remote endpoint.
      const match=chunk.match(/4\.sync,(\d+)\.([0-9]{1,16});/);
      if(match&&Number(match[1])===match[2].length){
        socket.send("4.sync,"+match[1]+"."+match[2]+";");
      }
      if(ready&&frame)finish();
    });
  });
}

await waitForServer();
let auth;
try{
  auth=await guacLogin(base,user,password);
  assert.ok(auth.authToken);
  const profiles=await guacConnections(base,auth);
  const fixture=profiles.find(p=>p.name==="NodeDesk QA xrdp"&&p.protocol==="rdp");
  assert.ok(fixture,"Authorized QA RDP profile was not found");
  const query=guacTunnelQuery(auth.authToken,fixture,1024,768);
  const result=await assertGuacamoleSession(guacWssTunnel(base)+"?"+query);
  assert.equal(result.ready,true);
  assert.equal(result.frame,true);
  console.log("PASS: Guacamole HTTPS login, authorized RDP profile, trusted WSS and framebuffer negotiation");
}finally{
  if(auth)await guacLogout(base,auth);
}
