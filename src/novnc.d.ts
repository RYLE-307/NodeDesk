declare module "@novnc/novnc/core/rfb.js" {
  export type VncCredentials = {username?:string;password?:string;target?:string};
  export default class RFB {
    constructor(target:HTMLElement,url:string,options?:{credentials?:VncCredentials;shared?:boolean});
    scaleViewport:boolean;
    viewOnly:boolean;
    clipViewport:boolean;
    resizeSession:boolean;
    addEventListener(name:string,callback:(event:Event)=>void):void;
    disconnect():void;
    focus():void;
    sendCredentials(credentials:VncCredentials):void;
    sendCtrlAltDel():void;
  }
}
