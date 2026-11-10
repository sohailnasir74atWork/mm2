/**
 * functions/uploadScanReport.js with Auth, the quota and Bunny stubbed.
 *
 *   node --test functions/test/uploadScanReport.test.js
 */
const test = require('node:test');
const assert = require('assert');

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mm2';
const { handleReport, io, PER_CALLER_PER_HOUR } = require('../uploadScanReport')._internal;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

function fakeRes() {
  const res = { code: 200, body: undefined, headers: {}, headersSent: false };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.send = (b) => { res.body = b; res.headersSent = true; return res; };
  return res;
}
const req = (body, headers = {}) => ({ method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4', ...headers }, body });

let puts;
let quota;
test.beforeEach(() => {
  puts = [];
  quota = new Map();
  io.verifyIdToken = async (t) => {
    if (t !== 'good-token') throw new Error('bad token');
    return { uid: 'user123' };
  };
  io.takeQuota = async (key, max) => {
    const n = (quota.get(key) || 0) + 1;
    if (n > max) return false;
    quota.set(key, n);
    return true;
  };
  io.storageKey = () => 'test-key';
  io.put = async (url, init) => { puts.push({ url, init }); return { ok: true, status: 201 }; };
  io.id = () => 'abc-123';
});

test('stores the picture and the scan JSON under scan-reports/mm2 with a random id', async () => {
  const res = fakeRes();
  await handleReport(req({ image: JPEG.toString('base64'), meta: { v: 1, app: '1.6.15 (59)' } }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { id: 'abc-123' });
  assert.deepEqual(puts.map((p) => p.url), [
    'https://storage.bunnycdn.com/post-gag/scan-reports/mm2/abc-123.jpg',
    'https://storage.bunnycdn.com/post-gag/scan-reports/mm2/abc-123.json',
  ]);
  assert.equal(JSON.parse(puts[1].init.body.toString()).app, '1.6.15 (59)');
});

test('refuses non-images and missing meta', async () => {
  let res = fakeRes();
  await handleReport(req({ image: HTML.toString('base64'), meta: {} }), res);
  assert.equal(res.code, 400);
  res = fakeRes();
  await handleReport(req({ image: JPEG.toString('base64') }), res);
  assert.equal(res.body.error, 'bad_meta');
  assert.equal(puts.length, 0);
});

test('limits each caller per hour; signed-in users count by uid', async () => {
  for (let i = 0; i < PER_CALLER_PER_HOUR; i++) {
    const res = fakeRes();
    await handleReport(req({ image: JPEG.toString('base64'), meta: {} }), res);
    assert.equal(res.code, 200);
  }
  let res = fakeRes();
  await handleReport(req({ image: JPEG.toString('base64'), meta: {} }), res);
  assert.equal(res.code, 429);
  res = fakeRes();
  await handleReport(req({ image: JPEG.toString('base64'), meta: {} }, { authorization: 'Bearer good-token' }), res);
  assert.equal(res.code, 200);
});
