import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from '../modules/billing/stripeSignature.js';

const SECRET = 'whsec_test_secret';
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });

const sign = (body: string | Buffer, t: number, secret = SECRET) =>
  createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');

describe('verifyStripeSignature', () => {
  it('accepts a valid signature (string and Buffer body)', () => {
    const header = `t=${NOW_S},v1=${sign(payload, NOW_S)}`;
    expect(verifyStripeSignature(payload, header, SECRET, 300, NOW_MS)).toBe(true);
    expect(verifyStripeSignature(Buffer.from(payload), header, SECRET, 300, NOW_MS)).toBe(true);
  });

  it('accepts when any of several v1 signatures matches (secret rotation)', () => {
    const header = `t=${NOW_S},v1=${'00'.repeat(32)},v1=${sign(payload, NOW_S)}`;
    expect(verifyStripeSignature(payload, header, SECRET, 300, NOW_MS)).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    const header = `t=${NOW_S},v1=${sign(payload, NOW_S, 'whsec_other')}`;
    expect(verifyStripeSignature(payload, header, SECRET, 300, NOW_MS)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const header = `t=${NOW_S},v1=${sign(payload, NOW_S)}`;
    expect(verifyStripeSignature(payload.replace('evt_1', 'evt_2'), header, SECRET, 300, NOW_MS)).toBe(false);
  });

  it('rejects a tampered timestamp even inside the tolerance window', () => {
    const header = `t=${NOW_S - 10},v1=${sign(payload, NOW_S)}`;
    expect(verifyStripeSignature(payload, header, SECRET, 300, NOW_MS)).toBe(false);
  });

  it('rejects expired timestamps (older than 5 min) and far-future ones', () => {
    const old = NOW_S - 301;
    expect(verifyStripeSignature(payload, `t=${old},v1=${sign(payload, old)}`, SECRET, 300, NOW_MS)).toBe(false);
    const future = NOW_S + 301;
    expect(verifyStripeSignature(payload, `t=${future},v1=${sign(payload, future)}`, SECRET, 300, NOW_MS)).toBe(false);
  });

  it('accepts a timestamp exactly at the 5 min boundary', () => {
    const edge = NOW_S - 300;
    expect(verifyStripeSignature(payload, `t=${edge},v1=${sign(payload, edge)}`, SECRET, 300, NOW_MS)).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['no v1', `t=${NOW_S}`],
    ['no t', `v1=${sign(payload, NOW_S)}`],
    ['non numeric t', `t=abc,v1=${sign(payload, NOW_S)}`],
    ['non hex / short v1', `t=${NOW_S},v1=zzzz`],
    ['v0 scheme only', `t=${NOW_S},v0=${sign(payload, NOW_S)}`],
  ])('rejects malformed header: %s', (_name, header) => {
    expect(verifyStripeSignature(payload, header as string | undefined, SECRET, 300, NOW_MS)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    const header = `t=${NOW_S},v1=${sign(payload, NOW_S, '')}`;
    expect(verifyStripeSignature(payload, header, '', 300, NOW_MS)).toBe(false);
  });
});
