import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCatalog, moveConnection, load, save } from '../src/catalog.ts';
const fixture = () => ({...emptyCatalog(), groups: [
  {id:'a',name:'Parent',parentId:null}, {id:'b',name:'Child',parentId:'a'}
], connections:[{id:'c',name:'Server',host:'localhost',port:22,username:'admin',protocol:'SSH',groupId:null,favorite:true}]});
test('move to parent, nested group and root preserves every other field and persists', () => {
  let data = fixture();
  const original = {...data.connections[0]};
  let raw = null;
  const storage = {getItem:()=>raw,setItem:(_,value)=>{raw=value;}};
  for (const groupId of ['a','b',null]) {
    data = moveConnection(data,'c',groupId);
    assert.deepEqual(data.connections[0], {...original,groupId});
    save(storage,data);
    assert.deepEqual(load(storage),data);
  }
});
test('invalid, cancelled and same-target moves leave the original catalog untouched', () => {
  const data = fixture();
  for(const [id,target] of [['missing','a'],['c','missing'],['c',null]]) assert.equal(moveConnection(data,id,target),data);
  assert.deepEqual(data,fixture());
});
test('failed persistence cannot mutate the source catalog', () => {
  const data=fixture();
  const next=moveConnection(data,'c','b');
  assert.throws(()=>save({getItem:()=>null,setItem:()=>{throw Error('quota');}},next));
  assert.deepEqual(data,fixture());
});
