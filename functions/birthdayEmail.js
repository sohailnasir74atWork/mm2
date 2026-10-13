/**
 * birthdayEmail.js — the birthday email itself, shared by
 * notifyBirthdayEmails.js (the daily send), emailUnsubscribe.js (the
 * unsubscribe page) and scripts/birthdays/send-test-email.js.
 *
 * Ported from Adopt Me (adoptme-jan7/functions/birthdayEmail.js, 2026-10-08)
 * on 2026-10-13. Sent through Brevo's transactional API from the domain
 * mm2values.app (it must be authenticated in Brevo first: see the deploy
 * notes in notifyBirthdayEmails.js). Copy is written per language for MM2
 * traders, in the app's own words (Code/Translation/*.json: "tradeo",
 * "Messer, Guns und Pets", "ножи, пушки и питомцы", "صفقات"...), not
 * translated line by line. Arabic renders right to left.
 *
 * The gift is the Birthdays screen's one: GIFT_STARS ⭐ stars, claimable on the
 * day by 13+ players whose account is 30+ days old (birthdays/core.js
 * claimBirthdayGift). Under that age rule the email says "players can wish
 * you" instead, so it never promises stars the app would refuse.
 *
 * Every email carries a one-click unsubscribe (RFC 8058 List-Unsubscribe
 * headers plus a footer link). The link is signed with EMAIL_UNSUB_SECRET so
 * nobody can unsubscribe someone else.
 */

const crypto = require('crypto');

const SENDER = { name: 'MM2 Values', email: 'hello@mm2values.app' };
const UTM = 'utm_source=brevo&utm_medium=email&utm_campaign=birthday';
// mm2values.app has no /app download route (Adopt Me's site does), so the
// button goes to the home page, which shows the store badges; the footer
// links straight to both stores (Code/Helper/Environment.js share links).
const APP_URL = `https://mm2values.app/?${UTM}`;
const PLAY_URL = `https://play.google.com/store/apps/details?id=com.mm2tradesvalues&referrer=${encodeURIComponent(UTM)}`;
const IOS_URL = 'https://apps.apple.com/app/id6747306748';
const UNSUB_BASE = 'https://us-central1-mm2vlaues-ed80c.cloudfunctions.net/emailUnsubscribe';
// Required by anti-spam law (CAN-SPAM): a real postal address in every email.
const POSTAL_ADDRESS = 'The Solana Labs · 27 E/45, POF, Wah Cantt 47040, Pakistan';
// The app's languages (Code/Helper/tradeMatch.js LANGS). es = Latin America, es-ES = Spain.
const LANGS = ['en', 'es', 'es-ES', 'pt', 'fr', 'de', 'ru', 'ja', 'ar'];
const GIFT_STARS = 15; // birthdays/core.js GIFT_STARS

const COPY = {
  en: {
    subjectNamedGift: 'Happy birthday, {{name}}! 🎂 Your birthday stars are waiting',
    subjectGift: 'Happy birthday! 🎂 Your birthday stars are waiting',
    subjectNamed: 'Happy birthday, {{name}}! 🎂',
    subject: 'Happy birthday! 🎂',
    preheaderGift: '{{stars}} ⭐ stars are waiting for you in MM2 Values. Claim them today!',
    preheader: 'Wishing you a great day and a Godly drop, from all of us at MM2 Values.',
    titleNamed: 'Happy birthday, {{name}}! 🎉',
    title: 'Happy birthday! 🎉',
    gift: 'Your birthday gift is waiting in the app: {{stars}} ⭐ stars. Claim them today, and may every knife, gun and pet trade go your way!',
    noGift: 'Have an amazing day! Other players can send you birthday wishes in the app today. May every knife, gun and pet trade go your way!',
    buttonGift: 'Claim my birthday stars',
    button: 'Open MM2 Values',
    signoff: 'Have a great birthday!',
    team: 'The MM2 Values team',
    why: "You got this email because it's your birthday and you have an MM2 Values account. We send it once a year, on your birthday.",
    unsubscribe: 'Unsubscribe',
    getApp: 'Get the app:',
    disclaimer: 'Fan-made app · not affiliated with Nikilis or Roblox',
  },
  es: {
    subjectNamedGift: '¡Feliz cumpleaños, {{name}}! 🎂 Tus estrellas de cumpleaños te esperan',
    subjectGift: '¡Feliz cumpleaños! 🎂 Tus estrellas de cumpleaños te esperan',
    subjectNamed: '¡Feliz cumpleaños, {{name}}! 🎂',
    subject: '¡Feliz cumpleaños! 🎂',
    preheaderGift: 'Tienes {{stars}} ⭐ estrellas de regalo en MM2 Values. ¡Reclámalas hoy!',
    preheader: 'Todo el equipo de MM2 Values te desea un día increíble. ¡Ojalá te toque una Godly!',
    titleNamed: '¡Feliz cumpleaños, {{name}}! 🎉',
    title: '¡Feliz cumpleaños! 🎉',
    gift: 'Tu regalo de cumpleaños te espera en la app: {{stars}} ⭐ estrellas. ¡Reclámalas hoy, y que todos tus tradeos de cuchillos, pistolas y mascotas salgan ganando!',
    noGift: '¡Que tengas un día increíble! Hoy otros jugadores pueden felicitarte en la app. ¡Que todos tus tradeos de cuchillos, pistolas y mascotas salgan ganando!',
    buttonGift: 'Reclamar mis estrellas',
    button: 'Abrir MM2 Values',
    signoff: '¡Que la pases increíble!',
    team: 'El equipo de MM2 Values',
    why: 'Te llegó este correo porque hoy es tu cumpleaños y tienes una cuenta en MM2 Values. Lo enviamos una vez al año, el día de tu cumpleaños.',
    unsubscribe: 'Cancelar suscripción',
    getApp: 'Descarga la app:',
    disclaimer: 'App hecha por fans · sin relación con Nikilis ni Roblox',
  },
  'es-ES': {
    subjectNamedGift: '¡Feliz cumpleaños, {{name}}! 🎂 Tienes estrellas de regalo esperándote',
    subjectGift: '¡Feliz cumpleaños! 🎂 Tienes estrellas de regalo esperándote',
    subjectNamed: '¡Feliz cumpleaños, {{name}}! 🎂',
    subject: '¡Feliz cumpleaños! 🎂',
    preheaderGift: '{{stars}} ⭐ estrellas de regalo te esperan en MM2 Values. ¡Reclámalas hoy!',
    preheader: 'Todo el equipo de MM2 Values te desea un día genial. ¡Ojalá te toque una Godly!',
    titleNamed: '¡Feliz cumpleaños, {{name}}! 🎉',
    title: '¡Feliz cumpleaños! 🎉',
    gift: 'Tu regalo de cumpleaños te espera en la app: {{stars}} ⭐ estrellas. ¡Reclámalas hoy y que todos tus tradeos de cuchillos, pistolas y mascotas te salgan redondos!',
    noGift: '¡Que pases un día genial! Hoy el resto de jugadores puede felicitarte desde la app. ¡Que todos tus tradeos de cuchillos, pistolas y mascotas te salgan redondos!',
    buttonGift: 'Reclamar mis estrellas',
    button: 'Abrir MM2 Values',
    signoff: '¡Que lo pases genial!',
    team: 'El equipo de MM2 Values',
    why: 'Recibes este correo porque hoy es tu cumpleaños y tienes una cuenta de MM2 Values. Solo lo enviamos una vez al año, el día de tu cumpleaños.',
    unsubscribe: 'Darme de baja',
    getApp: 'Descárgate la app:',
    disclaimer: 'App creada por fans · sin relación con Nikilis ni Roblox',
  },
  pt: {
    subjectNamedGift: 'Feliz aniversário, {{name}}! 🎂 Suas estrelas de aniversário estão te esperando',
    subjectGift: 'Feliz aniversário! 🎂 Suas estrelas de aniversário estão te esperando',
    subjectNamed: 'Feliz aniversário, {{name}}! 🎂',
    subject: 'Feliz aniversário! 🎂',
    preheaderGift: 'Tem {{stars}} ⭐ estrelas de presente pra você no MM2 Values. Resgate hoje!',
    preheader: 'A equipe do MM2 Values te deseja um dia incrível. Tomara que você tire uma Godly!',
    titleNamed: 'Feliz aniversário, {{name}}! 🎉',
    title: 'Feliz aniversário! 🎉',
    gift: 'Seu presente de aniversário está te esperando no app: {{stars}} ⭐ estrelas. Resgate hoje, e que todas as suas trocas de facas, armas e pets saiam no lucro!',
    noGift: 'Tenha um dia incrível! Hoje os outros jogadores podem te dar parabéns pelo app. Que todas as suas trocas de facas, armas e pets saiam no lucro!',
    buttonGift: 'Resgatar minhas estrelas',
    button: 'Abrir o MM2 Values',
    signoff: 'Aproveite muito o seu dia!',
    team: 'Equipe MM2 Values',
    why: 'Você recebeu este e-mail porque hoje é seu aniversário e você tem uma conta no MM2 Values. A gente só manda uma vez por ano, no dia do seu aniversário.',
    unsubscribe: 'Cancelar inscrição',
    getApp: 'Baixe o app:',
    disclaimer: 'App feito por fãs · sem ligação com a Nikilis ou o Roblox',
  },
  fr: {
    subjectNamedGift: 'Joyeux anniversaire, {{name}} ! 🎂 Tes étoiles d’anniversaire t’attendent',
    subjectGift: 'Joyeux anniversaire ! 🎂 Tes étoiles d’anniversaire t’attendent',
    subjectNamed: 'Joyeux anniversaire, {{name}} ! 🎂',
    subject: 'Joyeux anniversaire ! 🎂',
    preheaderGift: '{{stars}} ⭐ étoiles t’attendent dans MM2 Values. Récupère-les aujourd’hui !',
    preheader: 'Toute l’équipe de MM2 Values te souhaite une super journée. Et pourquoi pas une Godly ?',
    titleNamed: 'Joyeux anniversaire, {{name}} ! 🎉',
    title: 'Joyeux anniversaire ! 🎉',
    gift: 'Ton cadeau d’anniversaire t’attend dans l’appli : {{stars}} ⭐ étoiles. Récupère-les aujourd’hui, et que tous tes trades de couteaux, pistolets et animaux soient gagnants !',
    noGift: 'Passe une super journée ! Aujourd’hui, les autres joueurs peuvent te souhaiter ton anniversaire dans l’appli. Que tous tes trades de couteaux, pistolets et animaux soient gagnants !',
    buttonGift: 'Récupérer mes étoiles',
    button: 'Ouvrir MM2 Values',
    signoff: 'Profite bien de ta journée !',
    team: 'L’équipe MM2 Values',
    why: 'Tu reçois cet e-mail parce que c’est ton anniversaire et que tu as un compte MM2 Values. On l’envoie une fois par an, le jour de ton anniversaire.',
    unsubscribe: 'Se désabonner',
    getApp: 'Télécharge l’appli :',
    disclaimer: 'Appli créée par des fans · aucun lien avec Nikilis ni Roblox',
  },
  de: {
    subjectNamedGift: 'Alles Gute zum Geburtstag, {{name}}! 🎂 Deine Geburtstagssterne warten',
    subjectGift: 'Alles Gute zum Geburtstag! 🎂 Deine Geburtstagssterne warten',
    subjectNamed: 'Alles Gute zum Geburtstag, {{name}}! 🎂',
    subject: 'Alles Gute zum Geburtstag! 🎂',
    preheaderGift: '{{stars}} ⭐ Sterne warten in MM2 Values auf dich. Hol sie dir heute ab!',
    preheader: 'Das ganze MM2 Values Team wünscht dir einen tollen Tag. Hoffentlich ziehst du ein Godly!',
    titleNamed: 'Alles Gute zum Geburtstag, {{name}}! 🎉',
    title: 'Alles Gute zum Geburtstag! 🎉',
    gift: 'Dein Geburtstagsgeschenk wartet in der App: {{stars}} ⭐ Sterne. Hol sie dir heute ab! Wir wünschen dir nur starke Trades mit Messern, Guns und Pets.',
    noGift: 'Hab einen tollen Tag! Heute können dir andere Spieler in der App gratulieren. Wir wünschen dir nur starke Trades mit Messern, Guns und Pets.',
    buttonGift: 'Geburtstagssterne abholen',
    button: 'MM2 Values öffnen',
    signoff: 'Feier schön!',
    team: 'Dein MM2 Values Team',
    why: 'Du bekommst diese E-Mail, weil heute dein Geburtstag ist und du ein Konto bei MM2 Values hast. Wir schicken sie einmal im Jahr, an deinem Geburtstag.',
    unsubscribe: 'Abmelden',
    getApp: 'Hol dir die App:',
    disclaimer: 'Fan-App · keine Verbindung zu Nikilis oder Roblox',
  },
  ru: {
    subjectNamedGift: 'С днём рождения, {{name}}! 🎂 Тебя ждут праздничные звёзды',
    subjectGift: 'С днём рождения! 🎂 Тебя ждут праздничные звёзды',
    subjectNamed: 'С днём рождения, {{name}}! 🎂',
    subject: 'С днём рождения! 🎂',
    preheaderGift: 'В MM2 Values тебя ждут {{stars}} ⭐ звёзд в подарок. Забери их сегодня!',
    preheader: 'Вся команда MM2 Values желает тебе отличного дня. Пусть выпадет Godly!',
    titleNamed: 'С днём рождения, {{name}}! 🎉',
    title: 'С днём рождения! 🎉',
    gift: 'В приложении тебя ждёт подарок на день рождения: {{stars}} ⭐ звёзд. Забери его сегодня, и пусть каждый трейд с ножами, пушками и питомцами будет в плюс!',
    noGift: 'Отличного тебе дня! Сегодня другие игроки могут поздравить тебя прямо в приложении. Пусть каждый трейд с ножами, пушками и питомцами будет в плюс!',
    buttonGift: 'Забрать звёзды',
    button: 'Открыть MM2 Values',
    signoff: 'С праздником!',
    team: 'Команда MM2 Values',
    why: 'Это письмо пришло тебе, потому что сегодня твой день рождения и у тебя есть аккаунт в MM2 Values. Мы пишем раз в год, в твой день рождения.',
    unsubscribe: 'Отписаться',
    getApp: 'Скачать приложение:',
    disclaimer: 'Фанатское приложение · не связано с Nikilis и Roblox',
  },
  ja: {
    subjectNamedGift: '{{name}}さん、お誕生日おめでとう！🎂 誕生日スターが届いています',
    subjectGift: 'お誕生日おめでとう！🎂 誕生日スターが届いています',
    subjectNamed: '{{name}}さん、お誕生日おめでとう！🎂',
    subject: 'お誕生日おめでとう！🎂',
    preheaderGift: 'MM2 Valuesで{{stars}} ⭐ スターを受け取れます。今日のうちにどうぞ！',
    preheader: 'MM2 Valuesチーム一同、素敵な一日になるよう願っています。Godlyが当たりますように！',
    titleNamed: '{{name}}さん、お誕生日おめでとう！🎉',
    title: 'お誕生日おめでとう！🎉',
    gift: 'アプリに誕生日プレゼントが届いています：{{stars}} ⭐ スター。今日のうちに受け取ってください。ナイフ・銃・ペットのトレードがうまくいきますように！',
    noGift: '素敵な一日になりますように！今日は他のプレイヤーがアプリからお祝いメッセージを送れます。ナイフ・銃・ペットのトレードがうまくいきますように！',
    buttonGift: 'スターを受け取る',
    button: 'MM2 Valuesを開く',
    signoff: '最高の誕生日を！',
    team: 'MM2 Values チーム',
    why: '今日がお誕生日で、MM2 Valuesのアカウントをお持ちのため、このメールをお送りしています。メールはお誕生日に年1回だけ届きます。',
    unsubscribe: '配信停止',
    getApp: 'アプリはこちら：',
    disclaimer: 'ファンが作ったアプリです · Nikilis、Robloxとは関係ありません',
  },
  ar: {
    subjectNamedGift: 'عيد ميلاد سعيد يا {{name}}! 🎂 نجوم عيد ميلادك بانتظارك',
    subjectGift: 'عيد ميلاد سعيد! 🎂 نجوم عيد ميلادك بانتظارك',
    subjectNamed: 'عيد ميلاد سعيد يا {{name}}! 🎂',
    subject: 'عيد ميلاد سعيد! 🎂',
    preheaderGift: '{{stars}} ⭐ نجمة هدية بانتظارك في MM2 Values. استلمها اليوم!',
    preheader: 'فريق MM2 Values كله يتمنى لك يومًا رائعًا. أتمنى أن تحصل على Godly!',
    titleNamed: 'عيد ميلاد سعيد يا {{name}}! 🎉',
    title: 'عيد ميلاد سعيد! 🎉',
    gift: 'هدية عيد ميلادك بانتظارك في التطبيق: {{stars}} ⭐ نجمة. استلمها اليوم، ونتمنى أن تكون كل صفقاتك في السكاكين والمسدسات والحيوانات الأليفة رابحة!',
    noGift: 'نتمنى لك يومًا رائعًا! يستطيع اللاعبون اليوم تهنئتك بعيد ميلادك داخل التطبيق. ونتمنى أن تكون كل صفقاتك في السكاكين والمسدسات والحيوانات الأليفة رابحة!',
    buttonGift: 'استلم نجوم عيد ميلادي',
    button: 'افتح MM2 Values',
    signoff: 'كل عام وأنت بخير!',
    team: 'فريق MM2 Values',
    why: 'وصلتك هذه الرسالة لأن اليوم عيد ميلادك ولديك حساب في MM2 Values. نرسلها مرة واحدة في السنة، في يوم عيد ميلادك.',
    unsubscribe: 'إلغاء الاشتراك',
    getApp: 'حمّل التطبيق:',
    disclaimer: 'تطبيق من صنع المعجبين · لا علاقة له بـ Nikilis أو Roblox',
  },
};

// The unsubscribe page (emailUnsubscribe.js). "Settings → Email updates" uses
// the app's own labels (settings.email_updates in each Translation file).
const PAGE = {
  en: { confirmTitle: 'Unsubscribe from MM2 Values emails?', confirmBody: "We'll stop sending emails to this address.", confirm: 'Unsubscribe', doneTitle: "You're unsubscribed", doneBody: "You won't get emails from MM2 Values anymore. You can turn them back on in the app: Settings → Email updates.", bad: "This link isn't valid. Please use the link in your email." },
  es: { confirmTitle: '¿Cancelar los correos de MM2 Values?', confirmBody: 'Dejaremos de enviar correos a esta dirección.', confirm: 'Cancelar suscripción', doneTitle: 'Listo, ya no recibirás correos', doneBody: 'No te llegarán más correos de MM2 Values. Puedes volver a activarlos en la app: Ajustes → Novedades por correo.', bad: 'Este enlace no es válido. Usa el enlace de tu correo.' },
  'es-ES': { confirmTitle: '¿Darte de baja de los correos de MM2 Values?', confirmBody: 'Dejaremos de enviar correos a esta dirección.', confirm: 'Darme de baja', doneTitle: 'Te has dado de baja', doneBody: 'Ya no recibirás correos de MM2 Values. Puedes volver a activarlos en la app: Ajustes → Novedades por correo.', bad: 'Este enlace no es válido. Usa el enlace que te llegó en el correo.' },
  pt: { confirmTitle: 'Cancelar os e-mails do MM2 Values?', confirmBody: 'Vamos parar de enviar e-mails para este endereço.', confirm: 'Cancelar inscrição', doneTitle: 'Inscrição cancelada', doneBody: 'Você não vai mais receber e-mails do MM2 Values. Dá pra ativar de novo no app: Configurações → Novidades por e-mail.', bad: 'Este link não é válido. Use o link do seu e-mail.' },
  fr: { confirmTitle: 'Se désabonner des e-mails MM2 Values ?', confirmBody: 'Nous n’enverrons plus d’e-mails à cette adresse.', confirm: 'Se désabonner', doneTitle: 'Tu es désabonné(e)', doneBody: 'Tu ne recevras plus d’e-mails de MM2 Values. Tu peux les réactiver dans l’appli : Paramètres → Actus par e-mail.', bad: 'Ce lien n’est pas valide. Utilise le lien de ton e-mail.' },
  de: { confirmTitle: 'E-Mails von MM2 Values abbestellen?', confirmBody: 'Wir schicken keine E-Mails mehr an diese Adresse.', confirm: 'Abmelden', doneTitle: 'Du bist abgemeldet', doneBody: 'Du bekommst keine E-Mails mehr von MM2 Values. In der App kannst du sie wieder einschalten: Einstellungen → E-Mail-Updates.', bad: 'Dieser Link ist ungültig. Nutze bitte den Link aus deiner E-Mail.' },
  ru: { confirmTitle: 'Отписаться от писем MM2 Values?', confirmBody: 'Мы больше не будем писать на этот адрес.', confirm: 'Отписаться', doneTitle: 'Ты отписан(а)', doneBody: 'Письма от MM2 Values больше не придут. Включить их снова можно в приложении: Настройки → Новости на почту.', bad: 'Ссылка недействительна. Открой ссылку из письма.' },
  ja: { confirmTitle: 'MM2 Valuesのメール配信を停止しますか？', confirmBody: 'このアドレスへのメール送信を停止します。', confirm: '配信停止', doneTitle: '配信を停止しました', doneBody: 'MM2 Valuesからのメールは届かなくなります。アプリの「設定 → メールでのお知らせ」からいつでも再開できます。', bad: 'このリンクは無効です。メールに記載のリンクを使ってください。' },
  ar: { confirmTitle: 'إلغاء الاشتراك في رسائل MM2 Values؟', confirmBody: 'لن نرسل بعد الآن أي رسائل إلى هذا العنوان.', confirm: 'إلغاء الاشتراك', doneTitle: 'تم إلغاء اشتراكك', doneBody: 'لن تصلك رسائل من MM2 Values بعد الآن. يمكنك تفعيلها من جديد في التطبيق: الإعدادات ← تحديثات البريد.', bad: 'هذا الرابط غير صالح. استخدم الرابط الموجود في رسالتك.' },
};

/**
 * The app's language code → one of LANGS. Exact match first (es-ES is its
 * own language here), then the two-letter base (pt-BR → pt, es-419 → es),
 * else English.
 */
const pickLang = (lang) => {
  const raw = String(lang || 'en').trim();
  const exact = LANGS.find((l) => l.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const base = raw.slice(0, 2).toLowerCase();
  return LANGS.includes(base) ? base : 'en';
};

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Display names are the player's own choice: trimmed, capped, and dropped
// when empty or when they look like a link or an email address.
const cleanName = (name) => {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!n || /https?:|www\.|@|\.(com|net|org|app|gg)\b/i.test(n)) return '';
  return n;
};

const fill = (tpl, name) => tpl.replace('{{name}}', name).replace('{{stars}}', String(GIFT_STARS));

// ── Unsubscribe links ────────────────────────────────────────────────────
const unsubToken = (uid, secret) => crypto
  .createHmac('sha256', String(secret))
  .update(`unsub:${uid}`)
  .digest('base64url')
  .slice(0, 22);

const verifyUnsubToken = (uid, token, secret) => {
  if (!uid || !token || !secret) return false;
  const want = Buffer.from(unsubToken(uid, secret));
  const got = Buffer.from(String(token));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

const unsubUrl = (uid, lang, secret) =>
  `${UNSUB_BASE}?u=${encodeURIComponent(uid)}&t=${unsubToken(uid, secret)}&l=${encodeURIComponent(pickLang(lang))}`;

// ── The email ────────────────────────────────────────────────────────────
// Gmail files designed mail (colour blocks, big buttons, emoji subjects) under
// Promotions. `plain` reads like a personal note instead: plain paragraphs, a
// text link, no emoji in the subject.
const stripEmoji = (s) => s.replace(/\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]️?/gu, '').trim();

/** { subject, html, text } for one player. */
function renderBirthdayEmail({ name, gift, lang, unsubscribeUrl, plain = false }) {
  const l = pickLang(lang);
  const c = COPY[l];
  const n = cleanName(name);
  const subject = fill(n
    ? (gift ? c.subjectNamedGift : c.subjectNamed)
    : (gift ? c.subjectGift : c.subject), n);
  const title = n ? fill(c.titleNamed, n) : c.title;
  const body = fill(gift ? c.gift : c.noGift, n);
  const button = gift ? c.buttonGift : c.button;
  const preheader = fill(gift ? c.preheaderGift : c.preheader, n);
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const e = escapeHtml;
  const stores = `<a href="${e(PLAY_URL)}" style="color:inherit;">Google Play</a> · <a href="${e(IOS_URL)}" style="color:inherit;">App Store</a>`;
  const storesText = `${c.getApp} Google Play ${PLAY_URL} · App Store ${IOS_URL}`;

  if (plain) {
    const plainSubject = stripEmoji(subject);
    const html = `<!doctype html>
<html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(plainSubject)}</title></head>
<body style="margin:0;padding:16px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#222222;" dir="${dir}">
<div style="max-width:520px;">
<p style="margin:0 0 14px;">${e(stripEmoji(title))} 🎂</p>
<p style="margin:0 0 14px;">${e(body)}</p>
<p style="margin:0 0 14px;"><a href="${e(APP_URL)}" style="color:#1A73E8;">${e(button)}</a></p>
<p style="margin:0 0 22px;">${e(c.signoff)}<br>${e(c.team)}</p>
<p style="margin:0;font-size:12px;line-height:18px;color:#777777;">${e(c.why)}<br><a href="${e(unsubscribeUrl)}" style="color:#777777;">${e(c.unsubscribe)}</a> · ${e(POSTAL_ADDRESS)}<br>${e(c.getApp)} ${stores}<br>${e(c.disclaimer)}</p>
</div></body></html>`;
    const text = [stripEmoji(title), '', body, '', `${button}: ${APP_URL}`, '', c.signoff, c.team, '', '—',
      c.why, `${c.unsubscribe}: ${unsubscribeUrl}`, POSTAL_ADDRESS, storesText, c.disclaimer].join('\n');
    return { subject: plainSubject, html, text };
  }

  const html = `<!doctype html>
<html lang="${l}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#EEF0FB;" dir="${dir}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0FB;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:24px;" dir="${dir}">
      <tr><td style="background:#6A5ACD;border-radius:24px 24px 0 0;height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td align="center" style="padding:30px 26px 6px;font-size:64px;line-height:72px;">🎂</td></tr>
      <tr><td align="center" style="padding:6px 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:32px;font-weight:800;color:#141A33;">${e(title)}</td></tr>
      <tr><td align="center" style="padding:14px 28px 0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#454B66;">${e(body)}</td></tr>
      <tr><td align="center" style="padding:24px 26px 6px;">
        <a href="${e(APP_URL)}" style="display:inline-block;background:#6A5ACD;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:999px;">${gift ? '⭐ ' : ''}${e(button)}</a>
      </td></tr>
      <tr><td align="center" style="padding:20px 26px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#454B66;">${e(c.signoff)}<br><strong style="color:#141A33;">${e(c.team)}</strong></td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;" dir="${dir}">
      <tr><td align="center" style="padding:18px 20px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#7C809A;">
        ${e(c.why)}<br>
        <a href="${e(unsubscribeUrl)}" style="color:#7C809A;text-decoration:underline;">${e(c.unsubscribe)}</a><br>
        ${e(c.getApp)} ${stores}<br>
        ${e(POSTAL_ADDRESS)}<br>
        ${e(c.disclaimer)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    title, '', body, '', `${button}: ${APP_URL}`, '', c.signoff, c.team, '', '—',
    c.why, `${c.unsubscribe}: ${unsubscribeUrl}`, storesText, POSTAL_ADDRESS, c.disclaimer,
  ].join('\n');

  return { subject, html, text };
}

/** One email through Brevo's transactional API. Resolves Brevo's messageId. */
async function sendBrevo({ apiKey, to, toName, subject, html, text, unsubscribeUrl }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: SENDER,
      to: [toName ? { email: to, name: toName } : { email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: ['birthday', 'mm2'],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`brevo ${res.status}: ${body.code || ''} ${body.message || ''}`.trim());
  return body.messageId;
}

module.exports = {
  SENDER, APP_URL, PLAY_URL, IOS_URL, UNSUB_BASE, POSTAL_ADDRESS, LANGS, GIFT_STARS, COPY, PAGE,
  pickLang, escapeHtml, cleanName,
  unsubToken, verifyUnsubToken, unsubUrl,
  renderBirthdayEmail, sendBrevo,
};
