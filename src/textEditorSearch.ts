/** In-memory literal search for the small (128 KiB) SFTP text editor.
 * No regex, case folding, network requests or persistence.
 */
export const MAX_EDITOR_BYTES = 128 * 1024;
export const MAX_SEARCH_TERM = 256;
export const MAX_REPLACEMENTS = 4096;

export type EditorMatch = {start:number;end:number};

export function safeEditorText(value:string):boolean {
  return !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u.test(value)
    && new TextEncoder().encode(value).length<=MAX_EDITOR_BYTES;
}
export function validSearchTerm(needle:string):boolean {
  return needle.length>0 && needle.length<=MAX_SEARCH_TERM;
}
export function countLiteral(text:string,needle:string):number {
  if(!validSearchTerm(needle))return 0;
  let count=0,at=0,found=-1;
  while((found=text.indexOf(needle,at))!==-1){
    count++;
    if(count>MAX_REPLACEMENTS)return MAX_REPLACEMENTS+1;
    at=found+needle.length;
  }
  return count;
}
export function adjacentMatch(text:string,needle:string,position:number,
  direction:"next"|"previous"):EditorMatch|null {
  if(!validSearchTerm(needle))return null;
  const cursor=Math.max(0,Math.min(text.length,Math.trunc(position)));
  const start=direction==="next"
    ? (()=>{const at=text.indexOf(needle,cursor);return at<0?text.indexOf(needle):at;})()
    : (()=>{const at=text.lastIndexOf(needle,cursor-1);return at<0?text.lastIndexOf(needle):at;})();
  return start<0?null:{start,end:start+needle.length};
}
export function replaceLiteralSelection(text:string,needle:string,replacement:string,
  start:number,end:number):string|null {
  if(!validSearchTerm(needle)||text.slice(start,end)!==needle)return null;
  const updated=text.slice(0,start)+replacement+text.slice(end);
  return safeEditorText(updated)?updated:null;
}
export function replaceAllLiteral(text:string,needle:string,replacement:string):
  {text:string;count:number}|null {
  if(!validSearchTerm(needle))return null;
  const count=countLiteral(text,needle);
  if(count===0||count>MAX_REPLACEMENTS)return null;
  // Limit expansion before allocating a large joined string.
  if(new TextEncoder().encode(replacement).length*count>MAX_EDITOR_BYTES)return null;
  const updated=text.split(needle).join(replacement);
  return safeEditorText(updated)?{text:updated,count}:null;
}
