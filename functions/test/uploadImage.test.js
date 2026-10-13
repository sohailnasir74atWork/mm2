/**
 * functions/uploadImage.js, with Auth, the quota and Bunny stubbed — no
 * emulator, no network, no real storage key.
 *
 *   node --test functions/test/uploadImage.test.js
 */
const test = require('node:test');
const assert = require('assert');

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mm2';
const { handleUpload, io, KINDS, MAX_PER_HOUR } = require('../uploadImage')._internal;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

function fakeRes() {
  const res = { code: 200, body: undefined, headers: {}, headersSent: false };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.send = (b) => { res.body = b; res.headersSent = true; return res; };
  return res;
}

let puts;
let quota;
test.beforeEach(() => {
  puts = [];
  quota = new Map();
  io.verifyIdToken = async (t) => {
    if (t !== 'good-token') throw new Error('bad token');
    return { uid: 'user123' };
  };
  io.takeQuota = async (uid) => {
    const n = (quota.get(uid) || 0) + 1;
    if (n > MAX_PER_HOUR) return false;
    quota.set(uid, n);
    return true;
  };
  io.storageKey = () => 'test-key';
  io.put = async (url, init) => { puts.push({ url, init }); return { ok: true, status: 201 }; };
});

const call = async (body, { token = 'good-token', method = 'POST' } = {}) => {
  const res = fakeRes();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  await handleUpload({ method, headers, body }, res);
  return res;
};

test('signed-in avatar upload goes to avatars/<uid>/ and returns the pull-gag URL', async () => {
  const res = await call({ kind: 'avatar', data: JPEG.toString('base64') });
  assert.strictEqual(res.code, 200);
  assert.match(res.body.url, /^https:\/\/pull-gag\.b-cdn\.net\/avatars\/user123\/\d+-[0-9a-f]{12}\.jpg$/);
  assert.strictEqual(puts.length, 1);
  assert.match(puts[0].url, /^https:\/\/storage\.bunnycdn\.com\/post-gag\/avatars\/user123\//);
  assert.strictEqual(puts[0].init.method, 'PUT');
  assert.strictEqual(puts[0].init.headers.AccessKey, 'test-key');
  assert.ok(puts[0].init.body.equals(JPEG));
});

test('every kind maps to its folder; extension follows the bytes, not the client', async () => {
  for (const [kind, spec] of Object.entries(KINDS)) {
    const res = await call({ kind, data: PNG.toString('base64'), contentType: 'image/jpeg' });
    assert.strictEqual(res.code, 200, kind);
    assert.ok(res.body.url.startsWith(`https://pull-gag.b-cdn.net/${spec.dir}/user123/`), kind);
    assert.ok(res.body.url.endsWith('.png'), kind);
  }
});

test('no token or a bad token is 401 and nothing is uploaded', async () => {
  assert.strictEqual((await call({ kind: 'post', data: JPEG.toString('base64') }, { token: null })).code, 401);
  assert.strictEqual((await call({ kind: 'post', data: JPEG.toString('base64') }, { token: 'forged' })).code, 401);
  assert.strictEqual(puts.length, 0);
});

test('a caller cannot choose the path', async () => {
  const res = await call({ kind: 'post', data: JPEG.toString('base64'), path: 'data.json', remotePath: '../x' });
  assert.strictEqual(res.code, 200);
  assert.ok(!puts[0].url.includes('data.json') && !puts[0].url.includes('..'));
});

test('unknown kinds, including prototype keys, are refused', async () => {
  for (const kind of ['', 'json', '../avatars', 'constructor', '__proto__', undefined]) {
    assert.strictEqual((await call({ kind, data: JPEG.toString('base64') })).code, 400, String(kind));
  }
  assert.strictEqual(puts.length, 0);
});

test('non-images are refused by their bytes', async () => {
  for (const buf of [HTML, Buffer.from('{"items":[]}'), Buffer.alloc(0), Buffer.from([0xff, 0xd8])]) {
    assert.strictEqual((await call({ kind: 'post', data: buf.toString('base64') })).code, 400);
  }
  assert.strictEqual((await call({ kind: 'post', data: 12345 })).code, 400);
  assert.strictEqual(puts.length, 0);
});

test('size caps hold per kind', async () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(KINDS.avatar.maxBytes)]);
  assert.strictEqual((await call({ kind: 'avatar', data: big.toString('base64') })).code, 413);
  assert.strictEqual((await call({ kind: 'post', data: big.toString('base64') })).code, 200);
  const huge = Buffer.concat([JPEG, Buffer.alloc(KINDS.post.maxBytes)]);
  assert.strictEqual((await call({ kind: 'post', data: huge.toString('base64') })).code, 413);
});

test('hourly quota returns 429 once spent', async () => {
  quota.set('user123', MAX_PER_HOUR);
  assert.strictEqual((await call({ kind: 'chat', data: JPEG.toString('base64') })).code, 429);
  assert.strictEqual(puts.length, 0);
});

test('a Bunny failure is 502 and the error carries no key', async () => {
  io.put = async () => ({ ok: false, status: 401 });
  const res = await call({ kind: 'dm', data: JPEG.toString('base64') });
  assert.strictEqual(res.code, 502);
  assert.deepStrictEqual(res.body, { error: 'upload_failed' });
});

test('missing secret is a 500, not an unauthenticated PUT', async () => {
  io.storageKey = () => '';
  assert.strictEqual((await call({ kind: 'post', data: JPEG.toString('base64') })).code, 500);
  assert.strictEqual(puts.length, 0);
});

test('GET is 405; OPTIONS preflight is 204', async () => {
  assert.strictEqual((await call({}, { method: 'GET' })).code, 405);
  assert.strictEqual((await call({}, { method: 'OPTIONS', token: null })).code, 204);
});
