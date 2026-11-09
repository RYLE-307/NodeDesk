import type {Connection} from "./catalog";

/** Non-secret identity only; never forward a catalog object or UI password. */
export function vaultTarget(connection:Connection){
  return {id:connection.id,protocol:connection.protocol,host:connection.host,
    port:connection.port,username:connection.username};
}
