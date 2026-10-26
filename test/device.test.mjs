import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceLink, encodeDisplay } from '../device.mjs';
test('device frames contain only bounded display state, without user text', () => {
  const state = {timer:{remainingMs:1499001,phase:'focus',status:'running'},presence:'unknown'};
  assert.equal(encodeDisplay('1234abcd', 1, state, 'teasing'), 'S|1234abcd|1|1500|f|r|t|u|0|00000000|n\n');
  assert.equal(encodeDisplay('1234abcd', 2, state, 'happy',{flags:3,id:'deadbeef',code:'w'}), 'S|1234abcd|2|1500|f|r|h|u|3|deadbeef|w\n');
  state.timer.remainingMs = -100;
  assert.match(encodeDisplay('1234abcd', 3, state, 'neutral'), /\|3\|0\|/);
});
test('device connection requires fresh acknowledgement for this session and sequence', () => {
  const link = new DeviceLink('', () => {}, () => {}, {port:'off'});
  link.seq = 4;
  const ack = {type:'sync_ack',protocol:2,session:link.session,seq:4,expression:'happy',status:'running',remaining_seconds:10,effect_id:'00000000'};
  link.accept({...ack,session:'old'}); assert.equal(link.snapshot().connected,false);
  link.accept({...ack,seq:5}); assert.equal(link.snapshot().connected,false);
  link.accept({...ack,expression:'invalid'}); assert.equal(link.snapshot().connected,false);
  link.accept({...ack,remaining_seconds:-1}); assert.equal(link.snapshot().connected,false);
  link.accept(ack); assert.equal(link.snapshot().connected,true);
  const timestamp = link.lastAck;
  link.accept(ack, timestamp + 6000); assert.equal(link.lastAck,timestamp);
  link.lastAck = Date.now()-6000; assert.equal(link.snapshot().connected,false);
  link.accept({type:'bridge_status',status:'disconnected'}); assert.equal(link.lastAck,0);
  link.close();
});
