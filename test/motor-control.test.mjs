import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MotorControl} from '../motor-control.mjs';

test('manual motor validates limits, excludes concurrent jobs and checks result identity',()=>{
  const motor=new MotorControl();
  for(const degrees of [0,31,50,-15,15.5,'15'])assert.throws(()=>motor.start(degrees));
  motor.start(30);const {id}=motor.snapshot();
  assert.throws(()=>motor.start(15));
  assert.equal(motor.report({id:'wrong',status:'completed'}),false);
  assert.equal(motor.report({id,status:'completed',power:'on'}),false);
  assert.equal(motor.report({id,status:'completed',power:'off',pitch_torque:'off',motion_verified:false}),true);
  assert.equal(motor.busy,false);
});

test('unacknowledged motor job expires without replay',()=>{
  const motor=new MotorControl();motor.start(15);
  const job=motor.snapshot();assert.equal(motor.snapshot(job.requestedAt+60001).status,'timeout');
  assert.equal(motor.report({id:job.id,status:'running'}),false);
});

test('center preview changes only after a valid power-off result and stays within limits',()=>{
  const motor=new MotorControl();
  for(const value of [-16,16,0.5,'1'])assert.throws(()=>motor.center(value));
  motor.center(-1);assert.equal(motor.previewCenter,null);
  assert.throws(()=>motor.center(-2));
  const {id}=motor.snapshot();
  assert.equal(motor.report({id,status:'completed',power:'off',pitch_torque:'off',motion_verified:false,center_offset:0}),false);
  assert.equal(motor.report({id,status:'completed',power:'off',pitch_torque:'off',motion_verified:false,center_offset:-1}),true);
  assert.equal(motor.previewCenter,-1);
  motor.center(0);motor.report({id:motor.snapshot().id,status:'failed'});
  assert.equal(motor.previewCenter,-1);
});
