import test from 'node:test';
import assert from 'node:assert/strict';
import {main} from '../scripts/resolute/provision-thermometer.mjs';

test('thermometer provisioning does nothing unless explicitly enabled', async () => {
  assert.deepEqual(await main({}), {event: 'RESOLUTE_THERMOMETER_PROVISION_DISABLED'});
});
test('thermometer provisioning refuses a wrong database scope or weak passwords', async () => {
  const hex = c => c.repeat(64);
  const base = {RESOLUTE_PROVISION_THERMOMETER: 'true', RESOLUTE_SETUP_DB_URL: 'postgresql://u:p@postgres.railway.internal:5432/resolute',
    RESOLUTE_THERMOMETER_WRITER_PASSWORD: hex('a'), RESOLUTE_THERMOMETER_READER_PASSWORD: hex('b')};
  for (const patch of [{RESOLUTE_SETUP_DB_URL: 'postgresql://u:p@example.com:5432/resolute'}, {RESOLUTE_SETUP_DB_URL: 'postgresql://u:p@postgres.railway.internal:5432/other'},
    {RESOLUTE_THERMOMETER_WRITER_PASSWORD: 'short'}, {RESOLUTE_THERMOMETER_READER_PASSWORD: hex('a')}]) {
    await assert.rejects(main({...base, ...patch}), /Invalid setup scope/);
  }
});
