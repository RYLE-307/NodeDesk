import {test} from "node:test";
import assert from "node:assert/strict";
import {vncWebsocketEndpoint} from "../src/vncWebsocket.ts";

test("embedded VNC accepts only certificate-verified WSS endpoints",()=>{
  assert.equal(vncWebsocketEndpoint("wss://vnc.example.org/websockify"),
    "wss://vnc.example.org/websockify");
  assert.equal(vncWebsocketEndpoint("wss://example.org:8443/"),
    "wss://example.org:8443/");
  assert.equal(vncWebsocketEndpoint("wss://[2001:db8::1]:443/rfb"),
    "wss://[2001:db8::1]/rfb");
});

test("VNC endpoint never accepts unencrypted schemes, URL secrets or ambiguous paths",()=>{
  for(const value of [
    "", " wsS://host", "wss://host ", "ws://host/rfb", "https://host/",
    "http://host/", "wss://user:password@host/rfb", "wss://host/?token=secret",
    "wss://host/#fragment", "wss://host/%2Fpasswd", "wss://host/%5Cfile",
    "wss://host/\nrfb", "wss://", "wss://example.org:99999/rfb"
  ])assert.throws(()=>vncWebsocketEndpoint(value),undefined,value);
});
