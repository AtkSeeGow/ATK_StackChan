import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, defaults, timerAction, setPresence, reconcile, validateSettings, dayKey } from '../core.mjs';

test('nextStart switches a completed phase and starts it in one action, without recounting completion',()=>{
  const s=newState();timerAction(s,defaults,'start',0);reconcile(s,defaults,1500000);
  const count={...s.completed};
  timerAction(s,defaults,'nextStart',1501000);
  assert.equal(s.timer.phase,'break');assert.equal(s.timer.status,'running');
  assert.equal(s.timer.deadline,1801000);assert.deepEqual(s.completed,count);
  const deadline=s.timer.deadline;
  assert.throws(()=>timerAction(s,defaults,'nextStart',1502000));assert.equal(s.timer.deadline,deadline);
  reconcile(s,defaults,1801000);timerAction(s,defaults,'nextStart',1802000);
  assert.equal(s.timer.phase,'focus');assert.equal(s.timer.status,'running');assert.equal(s.timer.deadline,3302000);
});

test('pause and resume preserve remaining time; unknown does not pause', () => {
  const s = newState(), config = { ...defaults, absencePolicy: 'pause' };
  timerAction(s, config, 'start', 1000);
  setPresence(s, config, 'unknown', 2000);
  assert.equal(s.timer.status, 'running');
  timerAction(s, config, 'pause', 11000);
  assert.equal(s.timer.remainingMs, 1490000);
  timerAction(s, config, 'resume', 21000);
  assert.equal(s.timer.deadline, 1511000);
});

test('absence grace is applied at the grace boundary after downtime', () => {
  const s = newState(), config = { ...defaults, absencePolicy: 'grace', absenceGraceSeconds: 60 };
  timerAction(s, config, 'start', 0);
  setPresence(s, config, 'absent', 10000);
  reconcile(s, config, 2000000);
  assert.equal(s.timer.status, 'paused');
  assert.equal(s.timer.remainingMs, 1430000);
  assert.throws(() => timerAction(s, config, 'resume', 2000001));
  setPresence(s, config, 'present', 2000002);
  assert.equal(s.timer.status, 'paused');
  timerAction(s, config, 'resume', 2000003);
  assert.equal(s.timer.status, 'running');
});

test('repeated absent samples do not extend grace and unknown cancels pending grace', () => {
  const s = newState(), config = { ...defaults, absencePolicy: 'grace' };
  timerAction(s, config, 'start', 0);
  setPresence(s, config, 'absent', 1000);
  setPresence(s, config, 'absent', 10000);
  assert.equal(s.absentSince, 1000);
  setPresence(s, config, 'unknown', 20000);
  reconcile(s, config, 80000);
  assert.equal(s.timer.status, 'running');
});

test('completion is counted once on completion date; break requires manual start', () => {
  const s = newState(), config = { ...defaults, focusMinutes: 1 };
  const start = Date.parse('2026-10-22T15:59:30Z');
  timerAction(s, config, 'start', start);
  reconcile(s, config, start + 100000);
  reconcile(s, config, start + 200000);
  assert.equal(s.completed[dayKey(start + 60000)], 1);
  timerAction(s, config, 'next', start + 200000);
  assert.equal(s.timer.phase, 'break'); assert.equal(s.timer.status, 'idle');
  timerAction(s, config, 'start', start + 200001);
  reconcile(s, config, start + 1000000);
  assert.equal(Object.values(s.completed).reduce((a,b) => a+b, 0), 1);
});

test('idle timer can switch phase without starting or changing completion count',()=>{
  const s=newState(),config={...defaults,focusMinutes:30,breakMinutes:7};
  timerAction(s,config,'switch',1000);
  assert.deepEqual(s.timer,{phase:'break',status:'idle',remainingMs:420000,deadline:null,pauseReason:null});
  timerAction(s,config,'switch',2000);
  assert.equal(s.timer.phase,'focus');assert.equal(s.timer.remainingMs,1800000);
  timerAction(s,config,'start',3000);
  assert.throws(()=>timerAction(s,config,'switch',4000));
});

test('starting while already absent never increases duration', () => {
  const s = newState(), config = { ...defaults, absencePolicy: 'pause' };
  setPresence(s, config, 'absent', 1000);
  timerAction(s, config, 'start', 100000);
  assert.equal(s.timer.status, 'paused'); assert.equal(s.timer.remainingMs, 1500000);
});

test('settings reject invalid duration, policy, model and URLs', () => {
  assert.equal(validateSettings(defaults).model, defaults.model);
  for (const patch of [{focusMinutes: 0}, {breakMinutes: 1.5}, {absencePolicy:'invalid'}, {ollamaUrl:'file:///etc/passwd'}, {ollamaUrl:'http://user:pass@localhost'}, {model:'bad model'}]) {
    assert.throws(() => validateSettings({ ...defaults, ...patch }));
  }
});
