/**
 * Session-scoped write queue. A PTY input chunk may wait behind an earlier
 * write; a disconnect/reconnect during that wait must invalidate the chunk.
 *
 * The caller owns error reporting and decides whether to continue its queue.
 */
export function queueTerminalWrite(
  previous:Promise<unknown>,
  sessionId:string,
  data:string,
  activeSession:()=>string|null,
  write:(sessionId:string,data:string)=>Promise<unknown>,
):Promise<void> {
  return previous.catch(()=>{}).then(async()=>{
    if(activeSession()!==sessionId)return;
    await write(sessionId,data);
  });
}
