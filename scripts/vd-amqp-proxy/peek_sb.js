// Non-destructive peek + long-wait receive. Proves auth, subscription
// exists, and reports whether messages are buffered or arriving live.
import { ServiceBusClient } from '@azure/service-bus';
import { ClientSecretCredential } from '@azure/identity';

const {
  VD_AAD_TENANT_ID,
  VD_AAD_CLIENT_ID,
  VD_AAD_CLIENT_SECRET,
  VD_SB_FQDN,
  VD_SB_TOPIC,
  VD_SB_SUBSCRIPTION,
} = process.env;

const cred = new ClientSecretCredential(VD_AAD_TENANT_ID, VD_AAD_CLIENT_ID, VD_AAD_CLIENT_SECRET);
const client = new ServiceBusClient(VD_SB_FQDN, cred);
const receiver = client.createReceiver(VD_SB_TOPIC, VD_SB_SUBSCRIPTION, { receiveMode: 'peekLock' });

try {
  console.log('[1/2] Non-destructive peek (up to 20 buffered messages)...');
  const peeked = await receiver.peekMessages(20);
  console.log(`  peeked=${peeked.length}`);
  for (const [i, m] of peeked.entries()) {
    const body = typeof m.body === 'string' ? m.body : Buffer.isBuffer(m.body) ? m.body.toString('utf8') : String(m.body ?? '');
    console.log(`  peek[${i}] enq=${m.enqueuedTimeUtc?.toISOString?.() ?? '?'} body-len=${body.length} head=${body.slice(0, 120).replace(/\s+/g, ' ')}`);
  }

  console.log('[2/2] Live receive for up to 90 seconds...');
  const start = Date.now();
  const msgs = await receiver.receiveMessages(3, { maxWaitTimeInMs: 90_000 });
  console.log(`  received=${msgs.length} after ${((Date.now() - start) / 1000).toFixed(1)}s`);
  for (const [i, m] of msgs.entries()) {
    const body = typeof m.body === 'string' ? m.body : Buffer.isBuffer(m.body) ? m.body.toString('utf8') : String(m.body ?? '');
    console.log(`  msg[${i}] enq=${m.enqueuedTimeUtc?.toISOString?.() ?? '?'} body-len=${body.length}`);
    console.log('  head:', body.slice(0, 300));
    await receiver.abandonMessage(m);
  }
} catch (err) {
  console.error('ERROR:', err.name, err.code, err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 10).join('\n'));
}
await receiver.close();
await client.close();
process.exit(0);
