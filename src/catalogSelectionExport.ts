import {decode,emptyCatalog} from "./catalog.ts";
import type {Catalog,Connection} from "./catalog.ts";
import {MAX_BULK_CONNECTIONS} from "./catalogBulk.ts";

/**
 * Share an explicit subset of a NodeDesk catalog, never an OS-vault backup.
 * Rekey every exported ID so importing the subset via "Replace catalog"
 * also cannot silently bind to a saved credential in the receiving Vault.
 * Certificate trust pins must be verified independently on the recipient.
 */
export function exportSelectedCatalog(
  catalog:Catalog,
  selection:string[],
  nextId:()=>string=()=>crypto.randomUUID(),
):Catalog {
  const source=decode(JSON.stringify(catalog));
  if(!Array.isArray(selection) || selection.length<1 ||
     selection.length>MAX_BULK_CONNECTIONS ||
     selection.some(id=>typeof id!=="string" || !id))
    throw new Error("Invalid catalog export selection");
  const selected=new Set(selection);
  if(selected.size!==selection.length ||
     selection.some(id=>!source.connections.some(c=>c.id===id)))
    throw new Error("Unknown or duplicate export connection");

  const requiredGroups=new Set<string>();
  const groupsById=new Map(source.groups.map(g=>[g.id,g]));
  const chosen=source.connections.filter(c=>selected.has(c.id));
  for(const connection of chosen){
    let parent=connection.groupId;
    while(parent!==null){
      if(requiredGroups.has(parent))break;
      requiredGroups.add(parent);
      parent=groupsById.get(parent)?.parentId??null;
    }
  }
  const ancestors=source.groups.filter(g=>requiredGroups.has(g.id));
  const used=new Set([...source.groups,...source.connections].map(item=>item.id));
  function allocate():string {
    const id=nextId();
    if(typeof id!=="string" || !id || id.length>200 ||
       /[\u0000-\u001f\u007f]/u.test(id) || used.has(id))
      throw new Error("Invalid generated export ID");
    used.add(id);
    return id;
  }
  const remap=new Map(ancestors.map(g=>[g.id,allocate()]));
  const connections=chosen.map((c:Connection)=>{
    // Keep an explicit endpoint allowlist: never include stored RDP/VNC
    // trust material, private keys, passwords, transport options or tokens.
    return {
      id:allocate(),name:c.name,host:c.host,port:c.port,
      username:c.username,protocol:c.protocol,favorite:c.favorite,
      groupId:c.groupId===null?null:remap.get(c.groupId)!,
    };
  });
  return decode(JSON.stringify({
    ...emptyCatalog(),
    groups:ancestors.map(g=>({
      id:remap.get(g.id)!,name:g.name,
      parentId:g.parentId===null?null:remap.get(g.parentId)!,
    })),
    connections,
  }));
}
