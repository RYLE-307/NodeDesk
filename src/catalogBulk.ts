import {decode} from "./catalog.ts";
import type {Catalog} from "./catalog.ts";

export const MAX_BULK_CONNECTIONS = 50;

export type BulkConnectionAction =
  | {kind:"move";groupId:string|null}
  | {kind:"favorite";favorite:boolean};

/** Transactional, catalog-only changes. No connections, secrets or VPN actions. */
export function bulkUpdateConnections(
  catalog:Catalog,
  ids:string[],
  action:BulkConnectionAction,
):Catalog {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BULK_CONNECTIONS ||
      ids.some(id=>typeof id!=="string" || !id))
    throw new Error("Invalid bulk selection");
  const selected = new Set(ids);
  if (selected.size!==ids.length ||
      ids.some(id=>!catalog.connections.some(connection=>connection.id===id)))
    throw new Error("Stale or duplicate bulk selection");
  if (action.kind==="move") {
    if(action.groupId!==null &&
        !catalog.groups.some(group=>group.id===action.groupId))
      throw new Error("Unknown bulk destination group");
  } else if (action.kind!=="favorite" || typeof action.favorite!=="boolean") {
    throw new Error("Unknown bulk action");
  }
  const changed = catalog.connections.some(connection=>
    selected.has(connection.id) && (action.kind==="move" ?
      connection.groupId!==action.groupId : connection.favorite!==action.favorite));
  if (!changed) return catalog;
  const next = {
    ...catalog,
    connections:catalog.connections.map(connection=>{
      if(!selected.has(connection.id))return connection;
      return action.kind==="move" ?
        {...connection,groupId:action.groupId} :
        {...connection,favorite:action.favorite};
    }),
  };
  return decode(JSON.stringify(next));
}
