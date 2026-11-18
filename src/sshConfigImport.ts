import {decode,emptyCatalog} from "./catalog.ts";
import type {Catalog} from "./catalog.ts";

/** Read-only OpenSSH config preview values. No IdentityFile or commands cross
 * this allowlist and no OpenSSH config directive is evaluated by the UI.
 */
export type SshConfigPreview = {
  alias:string;host:string;port:number;username:string;
};
const hostPattern=/^[A-Za-z0-9.\-:[\]]+$/u;
const userPattern=/^[A-Za-z0-9._-]*$/u;

export function sshConfigPreviewToCatalog(value:unknown):Catalog {
  if (!Array.isArray(value) || value.length>40)
    throw new Error("Invalid SSH config preview");
  const aliases=new Set<string>();
  const connections=value.map((item,index)=>{
    if(!item || typeof item!=="object")throw new Error("Invalid SSH config entry");
    const record=item as Record<string,unknown>;
    const {alias,host,port,username}=record;
    if(typeof alias!=="string" || !alias || alias.length>200 ||
      !hostPattern.test(alias) || alias.startsWith("-") ||
      typeof host!=="string" || !host || host.length>253 ||
      !hostPattern.test(host) || host.startsWith("-") ||
      typeof username!=="string" || username.length>200 ||
      !userPattern.test(username) || username.startsWith("-") ||
      !Number.isInteger(port) || (port as number)<1 || (port as number)>65535)
      throw new Error("Invalid SSH config endpoint");
    const unique=alias.toLowerCase();
    if(aliases.has(unique))throw new Error("Duplicate SSH config alias");
    aliases.add(unique);
    return {
      id:"ssh-preview-"+(index+1),name:alias,host,port,username,
      protocol:"SSH",groupId:null,favorite:false,
    };
  });
  return decode(JSON.stringify({...emptyCatalog(),connections}));
}
