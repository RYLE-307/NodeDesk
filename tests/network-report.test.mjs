import {test} from "node:test";
import assert from "node:assert/strict";
import {createNetworkReport} from "../src/networkReport.ts";

const source={
  host:"secret.example.internal",port:8443,
  tcp:{addresses:["10.90.1.7"],tcpReachable:true,elapsedMs:10},
  ping:{reachable:false,elapsedMs:20,output:"PING secret.example.internal (10.90.1.7)"},
  trace:{elapsedMs:30,output:"1  10.90.1.1  0.2 ms"},
  ports:{addresses:["10.90.1.7"],elapsedMs:40,results:[{port:22,reachable:false},{port:443,reachable:true}]}
};
const createdAt="2026-11-08T12:00:00Z";

test("network report redacts target identities and raw tool output by default",()=>{
  const report=createNetworkReport(source,{createdAt,includeSensitive:false});
  assert.equal(report.version,2);
  assert.equal(report.redacted,true);
  assert.equal(report.target,null);
  assert.deepEqual(report.tcp,{port:8443,tcpReachable:true,elapsedMs:10});
  assert.deepEqual(report.ping,{reachable:false,elapsedMs:20});
  assert.deepEqual(report.trace,{elapsedMs:30});
  assert.deepEqual(report.ports,{elapsedMs:40,results:[{port:22,reachable:false},{port:443,reachable:true}]});
  const json=JSON.stringify(report);
  for(const secret of ["secret.example.internal","10.90.1.7","10.90.1.1","output","addresses"]){
    assert.equal(json.includes(secret),false);
  }
});

test("full network report includes sensitive fields only after explicit opt-in",()=>{
  const report=createNetworkReport(source,{createdAt,includeSensitive:true});
  assert.equal(report.redacted,false);
  assert.deepEqual(report.target,{host:"secret.example.internal"});
  assert.deepEqual(report.tcp?.addresses,["10.90.1.7"]);
  assert.match(report.ping?.output??"",/10.90.1.7/);
  assert.match(report.trace?.output??"",/10.90.1.1/);
  assert.deepEqual(report.ports?.addresses,["10.90.1.7"]);
});

test("network report handles partial results without fabricating successes",()=>{
  const report=createNetworkReport({...source,tcp:null,ping:null,trace:null,ports:null},
    {createdAt,includeSensitive:false});
  assert.equal(report.tcp,null);
  assert.equal(report.ping,null);
  assert.equal(report.trace,null);
  assert.equal(report.ports,null);
});
