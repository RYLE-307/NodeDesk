const specialKeys:Record<string,number>={Backspace:0xff08,Tab:0xff09,Enter:0xff0d,
  Escape:0xff1b,Delete:0xffff,Insert:0xff63,Home:0xff50,End:0xff57,
  PageUp:0xff55,PageDown:0xff56,ArrowLeft:0xff51,ArrowUp:0xff52,
  ArrowRight:0xff53,ArrowDown:0xff54,Shift:0xffe1,Control:0xffe3,
  Alt:0xffe9,Meta:0xffeb};

/** Browser key to RFB X11 keysym, with no fallback for unknown named keys. */
export function vncKeysym(key:string):number{
  if(specialKeys[key])return specialKeys[key];
  const codepoint=[...key].length===1?key.codePointAt(0):undefined;
  return codepoint===undefined?0:codepoint<=0xff?codepoint:0x01000000|codepoint;
}
