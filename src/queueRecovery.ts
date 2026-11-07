import {finishBatch, portableName} from "./filesModel.ts";
import type {BatchItem, FileEntry} from "./filesModel.ts";

/** Recovery metadata is an OPT-IN local WebView record, never credentials or file bytes.
 * The record is not an authorization to connect or write: fresh listings,
 * explicit confirmation and backend verification remain mandatory.
 */
export const RECOVERY_KEY = "nodedesk.sftp.recovery.v1";
const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORD_BYTES = 48 * 1024;
const MAX_RECORDS = 8;
const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type RecoveryEndpoint = {host:string;port:number;username:string};
export type RecoveryPartial = {index:number;previousId:string};
export type RecoveryRecord = {
  version:1; endpoint:RecoveryEndpoint; upload:boolean;
  localDirectory:string; remoteDirectory:string; names:string[];
  sourceEntries:FileEntry[]; items:BatchItem[];
  partial:RecoveryPartial|null; savedAt:number;
};
export type RecoveryStore = Pick<Storage,"getItem"|"setItem"|"removeItem">;

function textField(value:unknown,limit:number):value is string {
  return typeof value==="string" && value.length>0 && value.length<=limit &&
    !/[\x00-\x1f\x7f]/u.test(value);
}
function validEndpoint(value:unknown):value is RecoveryEndpoint {
  if (!value || typeof value!=="object")return false;
  const v=value as Record<string,unknown>;
  return textField(v.host,255) && textField(v.username,255) &&
    typeof v.port==="number" && Number.isInteger(v.port) && v.port>0 && v.port<=65535;
}
function validFileEntry(v:unknown):v is FileEntry {
  if (!v || typeof v!=="object")return false;
  const e=v as Record<string,unknown>;
  return typeof e.name==="string" && portableName(e.name) && e.kind==="file" &&
    (e.size===null || typeof e.size==="number" && Number.isSafeInteger(e.size) && e.size>=0) &&
    (e.modified===null || typeof e.modified==="number" && Number.isSafeInteger(e.modified) && e.modified>=0) &&
    (e.permissions===null || typeof e.permissions==="number" && Number.isSafeInteger(e.permissions) && e.permissions>=0);
}
const states=new Set(["queued","active","done","failed","cancelled","skipped"]);
export function validateRecovery(input:unknown,now=Date.now()):RecoveryRecord|null {
  if (!input || typeof input!=="object")return null;
  const v=input as Record<string,unknown>;
  if (v.version!==VERSION || !validEndpoint(v.endpoint) ||
    typeof v.upload!=="boolean" ||
    !textField(v.localDirectory,2048) || !textField(v.remoteDirectory,2048) ||
    (typeof v.savedAt!=="number" || !Number.isSafeInteger(v.savedAt)) ||
    Number(v.savedAt)>now+60000 || now-Number(v.savedAt)>MAX_AGE_MS ||
    !Array.isArray(v.names) || v.names.length<1 || v.names.length>50 ||
    !v.names.every(x=>typeof x==="string"&&portableName(x)) ||
    new Set(v.names).size!==v.names.length ||
    !Array.isArray(v.sourceEntries) || v.sourceEntries.length!==v.names.length ||
    !v.sourceEntries.every((item,i)=>validFileEntry(item)&&item.name===v.names[i]) ||
    !Array.isArray(v.items) || v.items.length!==v.names.length ||
    !v.items.every((item,i)=>item && item.name===v.names[i] && states.has(item.state)))
      return null;
  const partial=v.partial;
  if (partial!==null) {
    if(!partial||typeof partial!=="object")return null;
    const q=partial as Record<string,unknown>;
    if((typeof q.index!=="number"||!Number.isInteger(q.index))||Number(q.index)<0||
      Number(q.index)>=v.names.length ||
      typeof q.previousId!=="string"||!idPattern.test(q.previousId) ||
      (v.items[Number(q.index)] as BatchItem).state==="done")return null;
  }
  // On app recovery, never treat active/queued work as successfully complete.
  const items=finishBatch(v.items as BatchItem[]);
  if(items.every(item=>item.state==="done"))return null;
  return {
    version:1,endpoint:{...(v.endpoint as RecoveryEndpoint)},upload:v.upload as boolean,
    localDirectory:v.localDirectory as string,remoteDirectory:v.remoteDirectory as string,
    names:[...(v.names as string[])],
    sourceEntries:(v.sourceEntries as FileEntry[]).map(e=>({...e})),
    items,partial:partial?{...(partial as RecoveryPartial)}:null,
    savedAt:v.savedAt as number
  };
}
export function sameEndpoint(a:RecoveryEndpoint,b:RecoveryEndpoint):boolean {
  return a.host===b.host && a.port===b.port && a.username===b.username;
}
function readAll(store:RecoveryStore,now=Date.now()):RecoveryRecord[] {
  try{
    const raw=store.getItem(RECOVERY_KEY);
    if (!raw || raw.length>MAX_RECORD_BYTES*MAX_RECORDS)return [];
    const root=JSON.parse(raw);
    if(!root||root.version!==VERSION||!Array.isArray(root.records))return [];
    return root.records.slice(0,MAX_RECORDS).map((x:unknown)=>validateRecovery(x,now))
      .filter((x:RecoveryRecord|null):x is RecoveryRecord=>x!==null);
  }catch{return [];}
}
export function loadRecovery(store:RecoveryStore,endpoint:RecoveryEndpoint,now=Date.now()):RecoveryRecord|null {
  return readAll(store,now).find(r=>sameEndpoint(r.endpoint,endpoint)) ?? null;
}
export function saveRecovery(store:RecoveryStore,record:RecoveryRecord,now=Date.now()):boolean {
  try{
    const checked=validateRecovery(record,now);
    if(!checked)return false;
    const others=readAll(store,now).filter(r=>!sameEndpoint(r.endpoint,checked.endpoint));
    const encoded=JSON.stringify({version:1,records:[checked,...others].slice(0,MAX_RECORDS)});
    if(new TextEncoder().encode(encoded).length>MAX_RECORD_BYTES*MAX_RECORDS)return false;
    store.setItem(RECOVERY_KEY,encoded);
    return true;
  }catch{return false;}
}
export function forgetRecovery(store:RecoveryStore,endpoint:RecoveryEndpoint):void {
  try{
    const remain=readAll(store).filter(r=>!sameEndpoint(r.endpoint,endpoint));
    if(remain.length)store.setItem(RECOVERY_KEY,JSON.stringify({version:1,records:remain}));
    else store.removeItem(RECOVERY_KEY);
  }catch{/* Corrupt or unavailable private storage is never a reason to connect. */}
}
