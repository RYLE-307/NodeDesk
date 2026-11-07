import {test} from "node:test";
import assert from "node:assert/strict";
import {guacamoleWssEndpoint} from "../src/guacamoleTunnel.ts";

test("Guacamole tunnel requires explicit encrypted WSS",()=>{
  assert.equal(guacamoleWssEndpoint("wss://gateway.example.org/websocket-tunnel"),
    "wss://gateway.example.org/websocket-tunnel");
  assert.equal(guacamoleWssEndpoint("wss://gateway.local:8443/tunnel"),
    "wss://gateway.local:8443/tunnel");
});
test("Guacamole tunnel refuses URL credentials, tokens, plaintext and malformed endpoints",()=>{
  for(const url of ["","ws://host/tunnel","https://host/tunnel",
    "wss://admin:pass@host/tunnel","wss://host/tunnel?token=abc",
    "wss://host/tunnel#secret","wss://host/%2froute","wss://host/%5csecret",
    "wss://host/\nconnect"," wss://host/tunnel","wss://host/tunnel ",
    "wss://host:99999/tunnel","WSS://host/tunnel"])
    assert.throws(()=>guacamoleWssEndpoint(url),undefined,url);
});
