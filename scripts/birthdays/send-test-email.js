// Send ONE MM2 birthday email (functions/birthdayEmail.js) to a test address.
// Ported from Adopt Me's scripts/birthdays/send-test-email.js. It really sends,
// through Brevo, from hello@mm2values.app, so the domain must be authenticated
// in Brevo first. The keys come from Secret Manager into the environment, never
// the command line:
//
//   BREVO_API_KEY=$(gcloud secrets versions access latest --secret=BREVO_API_KEY --project=mm2vlaues-ed80c) \
//   EMAIL_UNSUB_SECRET=$(gcloud secrets versions access latest --secret=EMAIL_UNSUB_SECRET --project=mm2vlaues-ed80c) \
//   node scripts/birthdays/send-test-email.js --to you@example.com [--lang es-ES] [--name Alice] [--no-gift] [--plain] [--uid <firebase uid>]
//
// Languages: en es es-ES pt fr de ru ja ar.
// --uid makes the footer's unsubscribe link work for that account (it really
// turns email off for it once emailUnsubscribe is deployed); without it the
// link points at a dummy account.

const path = require('path');
const { renderBirthdayEmail, sendBrevo, unsubUrl, cleanName, pickLang } = require(path.join(__dirname, '..', '..', 'functions', 'birthdayEmail'));

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

(async () => {
  const to = arg('--to');
  const apiKey = process.env.BREVO_API_KEY;
  const secret = process.env.EMAIL_UNSUB_SECRET;
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !apiKey || !secret) {
    console.error('Need --to <one address>, plus BREVO_API_KEY and EMAIL_UNSUB_SECRET in the environment (see the header).');
    process.exit(1);
  }
  const lang = pickLang(arg('--lang', 'en'));
  const name = arg('--name', 'Sohail');
  const gift = !process.argv.includes('--no-gift');
  const uid = arg('--uid', 'TESTUSER000000000000');
  const unsubscribeUrl = unsubUrl(uid, lang, secret);
  const plain = process.argv.includes('--plain');
  const mail = renderBirthdayEmail({ name, gift, lang, unsubscribeUrl, plain });
  const id = await sendBrevo({ apiKey, to, toName: cleanName(name), unsubscribeUrl, ...mail });
  console.log(`sent "${mail.subject}" to ${to} (${lang}${gift ? ', gift' : ''}) — Brevo id ${id}`);
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
