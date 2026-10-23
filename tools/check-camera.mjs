// Live hardware smoke test. Image bytes stay in RAM and are never printed/saved.
const base = 'http://127.0.0.1:3000';
const start = await fetch(base+'/api/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start'})});
if (!start.ok) throw new Error('Could not start camera');
let state;
for (let attempt=0;attempt<30;attempt++) {
  state = await (await fetch(base+'/api/state')).json();
  if (state.camera.fresh && state.camera.seq >= 2) {
    const response = await fetch(base+'/api/camera/frame');
    const image = Buffer.from(await response.arrayBuffer());
    if (!response.ok || response.headers.get('content-type') !== 'image/jpeg' || image[0] !== 255 || image[1] !== 216 || image.at(-2) !== 255 || image.at(-1) !== 217) throw new Error('Invalid live JPEG');
    console.log(JSON.stringify({verified:true,jpegBytes:image.length,camera:state.camera,device:state.device},null,2));
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve,1000));
}
console.error(JSON.stringify({verified:false,camera:state?.camera,device:state?.device},null,2));
process.exit(1);
