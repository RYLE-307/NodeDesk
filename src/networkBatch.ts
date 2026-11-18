import type {Connection} from "./catalog.ts";

export const MAX_NETWORK_BATCH = 10;
export type NetworkBatchEndpoint = Pick<Connection,"id"|"name"|"host"|"port"|"protocol">;

/**
 * Explicitly picked, read-only endpoint probes. Do not hand the network UI
 * catalog fields other than the five allowlisted display/endpoint values.
 */
export function planCatalogNetworkBatch(
  catalog:Connection[],selectedIds:string[],
):NetworkBatchEndpoint[] {
  if(!Array.isArray(catalog) || !Array.isArray(selectedIds) ||
     selectedIds.length===0 || selectedIds.length>MAX_NETWORK_BATCH)
    throw new Error("Invalid network batch selection");
  const chosen=new Set(selectedIds);
  if(chosen.size!==selectedIds.length ||
     selectedIds.some(id=>typeof id!=="string" || !id))
    throw new Error("Duplicate or invalid network selection");
  const rows=catalog.filter(c=>chosen.has(c.id));
  if(rows.length!==chosen.size)throw new Error("Stale catalog network selection");
  for(const c of rows){
    if(!c || typeof c.id!=="string" || typeof c.name!=="string" ||
       !["SSH","RDP","VNC"].includes(c.protocol) ||
       typeof c.host!=="string" || !c.host || c.host.length>253 ||
       /[\s/@?#\\]/u.test(c.host) || c.host.startsWith("-") ||
       !Number.isInteger(c.port) || c.port<1 || c.port>65535)
      throw new Error("Invalid catalog network endpoint");
  }
  return rows.map(c=>({id:c.id,name:c.name,host:c.host,port:c.port,protocol:c.protocol}));
}
