// Read-only hardware check against the running local service.
const expected = process.argv[2] || 'idle';
let result;
for (let attempt = 0; attempt < 10; attempt++) {
  result = await (await fetch('http://127.0.0.1:3000/api/state')).json();
  if (result.device?.connected && result.timer.status === expected && result.device.applied?.status === expected && Math.abs(result.device.applied.remainingSeconds - result.timer.remainingMs / 1000) < 3) {
    if (process.argv.includes('--stable')) {
      if (!['idle','paused'].includes(expected) || !Number.isInteger(result.device.applied.renderCount)) throw new Error('Stable rendering check requires an idle/paused device with render telemetry');
      const count = result.device.applied.renderCount;
      const firstAck = result.device.lastAck;
      for (let sample = 0; sample < 4; sample++) {
        await new Promise(resolve => setTimeout(resolve,1000));
        result = await (await fetch('http://127.0.0.1:3000/api/state')).json();
        if (!result.device?.connected || result.timer.status !== expected || result.device.applied.renderCount !== count) throw new Error('Display redrew or changed state during the stable rendering check');
      }
      if (result.device.lastAck <= firstAck) throw new Error('Device acknowledgements stopped');
      console.log('Stable display confirmed: USB acknowledgements continued without redraws.');
    }
    console.log(JSON.stringify({verified:true,timer:result.timer,device:result.device},null,2));
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve,500));
}
console.error(JSON.stringify({verified:false,expected,timer:result?.timer,device:result?.device},null,2));
process.exit(1);
