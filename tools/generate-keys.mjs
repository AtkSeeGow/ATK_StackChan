// Fill only empty credential entries; never print secrets or overwrite existing keys.
import { randomBytes } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const file = path.join(root,'.env');
let text = readFileSync(existsSync(file) ? file : path.join(root,'.env.example'),'utf8');
for (const [key,value] of Object.entries({STACKCHAN_DEVICE_TOKEN:randomBytes(32).toString('hex'),STACKCHAN_WEB_USER:'owner',STACKCHAN_WEB_PASSWORD:randomBytes(24).toString('hex')})) {
  const line = new RegExp(`^${key}=(.*)$`,'m');
  const found = text.match(line);
  if (!found) text += `\n${key}=${value}\n`;
  else if (!found[1].trim()) text = text.replace(line,`${key}=${value}`);
}
writeFileSync(file,text,{mode:0o600});
console.log('Credential fields prepared in .env. Existing non-empty values were preserved. No secrets were printed.');
