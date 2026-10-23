import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraState } from '../camera.mjs';
const jpeg = Buffer.concat([Buffer.from([255,216]),Buffer.alloc(100),Buffer.from([255,217])]).toString('base64');
const sample = (candidate,baseline=false) => ({type:'camera_frame',jpeg,candidate,baseline,faces:candidate==='present'?1:0,reason:'test'});
test('camera presence needs consecutive face evidence; stale and disabled frames become unknown', () => {
  const c = new CameraState(); c.enable(true);
  c.accept(sample('present'),1000); assert.equal(c.snapshot(1000).presence,'unknown');
  c.accept(sample('present'),3000); assert.equal(c.snapshot(3000).presence,'present');
  assert.equal(c.snapshot(11000).presence,'unknown');
  c.accept(sample('present'),12000); assert.equal(c.snapshot(12000).presence,'unknown');
  c.enable(false); assert.equal(c.jpeg,null); assert.equal(c.accept(sample('present'),13000),false);
});
test('absence requires an explicit empty-scene baseline and ten seconds; unknown resets evidence', () => {
  const c = new CameraState(); c.enable(true);
  for(let time=1000;time<=13000;time+=2000) c.accept(sample('absent'),time);
  assert.equal(c.snapshot(13000).presence,'unknown');
  for(let time=15000;time<=25000;time+=2000) c.accept(sample('absent',true),time);
  assert.equal(c.snapshot(25000).presence,'absent');
  c.accept(sample('unknown',true),27000); assert.equal(c.snapshot(27000).presence,'unknown');
  assert.equal(c.accept({...sample('present'),jpeg:'invalid'},29000),false);
});
