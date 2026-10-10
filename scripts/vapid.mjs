// Makes your VAPID keys for phone notifications. Run: npm run vapid
import { webcrypto as c } from 'node:crypto';
const k = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = Buffer.from(await c.subtle.exportKey('raw', k.publicKey)).toString('base64url');
const jwk = await c.subtle.exportKey('jwk', k.privateKey);
console.log('\nRun these two commands and paste the value when asked:\n');
console.log('  npx wrangler secret put VAPID_PUBLIC     ->', pub);
console.log('  npx wrangler secret put VAPID_PRIVATE    ->', jwk.d);
console.log('\n(optional) npx wrangler secret put VAPID_SUBJECT -> mailto:you@example.com\n');
