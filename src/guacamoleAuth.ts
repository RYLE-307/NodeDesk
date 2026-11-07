export type GuacAuth = {
  authToken:string;
  dataSource:string;
  availableDataSources:string[];
};
export type GuacConnection = {id:string;name:string;source:string;protocol:"rdp"};

export function guacBase(input:string):string {
  if(typeof input!=="string"||!input.startsWith("https://")||
     input!==input.trim()||input.length>2048||
     /[\u0000-\u001f\u007f]/.test(input)||/%2e|%2f|%5c|%00/i.test(input)) {
    throw new Error("Only a secure HTTPS Guacamole server URL is allowed");
  }
  let u:URL;
  try {u=new URL(input);}
  catch {throw new Error("Invalid Guacamole HTTPS URL");}
  if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.search||u.hash||
     /%2f|%5c|%00|%2e/i.test(u.pathname)) {
    throw new Error("Guacamole server URL must not include credentials, tokens or fragments");
  }
  if(!u.pathname.endsWith("/"))u.pathname+="/";
  return u.href;
}

function id(value:unknown):value is string {
  return typeof value==="string"&&value.length>0&&value.length<=180&&
    /^[A-Za-z0-9_.-]+$/.test(value);
}
function token(value:unknown):value is string {
  return typeof value==="string"&&value.length>0&&value.length<=4096&&
    !/[\s\u0000-\u001f\u007f]/.test(value);
}
export function parseGuacAuth(raw:unknown):GuacAuth {
  const o=raw as Record<string,unknown>|null;
  if(!o||typeof o!=="object"||!token(o.authToken)||!id(o.dataSource)||
     !Array.isArray(o.availableDataSources)||o.availableDataSources.length>20||
     !o.availableDataSources.every(id))throw new Error("Unexpected Guacamole authentication response");
  return {authToken:o.authToken,dataSource:o.dataSource,
    availableDataSources:[...new Set(o.availableDataSources)]};
}
export function parseRdpConnections(raw:unknown,source:string):GuacConnection[] {
  if(!id(source)||!raw||typeof raw!=="object"||Array.isArray(raw))
    throw new Error("Invalid Guacamole connection list");
  const values=Object.values(raw as Record<string,unknown>);
  if(values.length>1000)throw new Error("Too many Guacamole connection profiles");
  const output:GuacConnection[]=[];
  for(const item of values) {
    if(!item||typeof item!=="object")continue;
    const entry=item as Record<string,unknown>;
    if(entry.protocol!=="rdp"||!id(entry.identifier)||
       typeof entry.name!=="string"||entry.name.length>256||
       /[\u0000-\u001f\u007f]/.test(entry.name))continue;
    output.push({id:entry.identifier,name:entry.name,source,protocol:"rdp"});
  }
  return output;
}
export function guacTunnelQuery(authToken:string,profile:GuacConnection,width:number,height:number):string {
  if(!token(authToken)||!id(profile.id)||!id(profile.source)||profile.protocol!=="rdp"||
     !Number.isInteger(width)||!Number.isInteger(height)||
     width<320||width>7680||height<240||height>4320)
    throw new Error("Invalid Guacamole session parameters");
  return new URLSearchParams({
    token:authToken,GUAC_DATA_SOURCE:profile.source,GUAC_ID:profile.id,
    GUAC_TYPE:"c",GUAC_WIDTH:String(width),GUAC_HEIGHT:String(height),
    GUAC_DPI:"96"
  }).toString();
}
export function guacWssTunnel(base:string):string {
  const u=new URL("websocket-tunnel",guacBase(base));
  u.protocol="wss:";
  return u.href;
}

const fetchOptions={
  cache:"no-store" as const,
  credentials:"omit" as const,
  redirect:"error" as const
};

export async function guacLogin(base:string,username:string,password:string,signal?:AbortSignal):Promise<GuacAuth>{
  if(!username||username.length>200||/[\r\n]/.test(username)||!password||password.length>4096)
    throw new Error("Enter your Guacamole username and password");
  const url=new URL("api/tokens",guacBase(base));
  const body=new URLSearchParams({username,password});
  const res=await fetch(url.href,{
    ...fetchOptions,method:"POST",mode:"cors",
    headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
    body,signal
  });
  if(!res.ok)throw new Error("Guacamole sign-in was rejected");
  return parseGuacAuth(await res.json());
}

export async function guacConnections(base:string,auth:GuacAuth,signal?:AbortSignal):Promise<GuacConnection[]> {
  const all:GuacConnection[]=[];
  for(const source of auth.availableDataSources){
    const u=new URL("api/session/data/"+encodeURIComponent(source)+"/connections",guacBase(base));
    // Guacamole 1.6 REST API expects the auth token in a query parameter.
    // Gateway reverse proxies MUST redact token/query strings in access logs.
    u.searchParams.set("token",auth.authToken);
    const res=await fetch(u.href,{...fetchOptions,method:"GET",mode:"cors",signal});
    if(!res.ok)continue;
    all.push(...parseRdpConnections(await res.json(),source));
  }
  return all.slice(0,200).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function guacLogout(base:string,auth:GuacAuth):Promise<void>{
  // Guacamole invalidation uses a token in the REST path; intentionally
  // suppress all errors so logout failures never leak the URL/token.
  const u=new URL("api/tokens/"+encodeURIComponent(auth.authToken),guacBase(base));
  try{await fetch(u.href,{...fetchOptions,method:"DELETE",mode:"cors"});}catch{/* UI clears token regardless */}
}
