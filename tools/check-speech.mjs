// Metadata-only connection check; does not record or submit audio.
import {existsSync} from 'node:fs';
import path from 'node:path';
import {SpeechService} from '../speech.mjs';
const env=path.resolve(import.meta.dirname,'..','.env');
if(existsSync(env))process.loadEnvFile(env);
try {
 const client=new SpeechService(process.env.STACKCHAN_STT_URL,process.env.STACKCHAN_STT_TOKEN);
 const result=await client.health();
 console.log(JSON.stringify(result));
}catch {
 console.error('Speech service unavailable. Check URL, matching key, service startup and firewall. No secrets printed.');process.exitCode=1;
}
