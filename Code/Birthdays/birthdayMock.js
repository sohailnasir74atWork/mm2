/**
 * birthdayMock.js — __DEV__-only stand-in for functions/birthdays, so the
 * Birthdays screens can be previewed on a simulator before the functions are
 * deployed (or while signed out). Same shapes and rules as the server, kept
 * in memory; it never touches RTDB or real stars. Ported from Blox Fruit.
 *
 * `setPreview()` moves "your" birthday (today / soon / later / none), which
 * is how the dev panel on the Birthdays screen shows every Home card state.
 */

// `reason`: why the server would rank them first.
const PLAYERS = [
  { uid: 'm1', name: 'GodlyHunter', avatar: null, offset: 0, wishes: 14, reason: 'dm' },
  { uid: 'm2', name: 'ChromaKing', avatar: null, offset: 0, wishes: 9, reason: 'follow' },
  { uid: 'm3', name: 'HarvesterFan', avatar: null, offset: 0, wishes: 6, reason: 'group' },
  { uid: 'm4', name: 'sheriff_sam22', avatar: null, offset: 0, wishes: 2, reason: 'wished_you' },
  { uid: 'm5', name: 'ShadowTrader', avatar: null, offset: 1, wishes: 0 },
  // Enough for "See all" + "Load more" (pages of 20).
  ...['Icebreaker', 'Nik', 'Corrupt', 'Bat', 'Elderwood', 'Darkbringer', 'Lightbringer', 'Hallowscythe',
    'Luger', 'Blaster', 'Heat', 'Swirly', 'Candy', 'Seer', 'Slasher', 'Saw', 'Ice', 'Spider',
    'Harvester', 'Icepiercer', 'Sugar', 'Evergun', 'Bauble', 'Gingerscope'].map((n, i) => ({
    uid: `g${i}`, name: `${n}Main${i}`, avatar: null, offset: i < 20 ? 0 : 1, wishes: i % 5,
  })),
];

const RECEIVED = [
  { name: 'GodlyHunter', avatar: null, template: 'hbd' },
  { name: 'ChromaKing', avatar: null, template: 'party' },
  { name: 'HarvesterFan', avatar: null, template: 'gift' },
  { name: 'sheriff_sam22', avatar: null, template: 'cake' },
  { name: 'ShadowTrader', avatar: null, template: 'hbd' },
];

const monthDayIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return { month: d.getMonth() + 1, day: d.getDate() };
};
const pad2 = (n) => String(n).padStart(2, '0');

const OFFSETS = { today: 0, soon: 3, later: 60 };

const state = {
  preview: 'today',   // 'today' | 'soon' | 'later' | 'none'
  show: true,         // shown by default
  edited: null,       // { month, day } after the one correction
  added: null,        // 'YYYY-MM-DD' added in 'none'
  giftOpened: false,
  thanked: false,
  wished: new Set(),
};

const RANK = { dm: 4, follow: 3, group: 2, wished_you: 1 };

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const wait = (v, ms = 250) => new Promise((r) => setTimeout(() => r(v), ms));

const myMonthDay = () => {
  if (state.edited) return state.edited;
  if (state.preview === 'none') {
    if (!state.added) return null;
    const [, m, d] = state.added.split('-').map(Number);
    return { month: m, day: d };
  }
  return monthDayIn(OFFSETS[state.preview] ?? 0);
};
const isToday = () => {
  const md = myMonthDay();
  const t = monthDayIn(0);
  return !!md && md.month === t.month && md.day === t.day;
};

const mine = () => {
  const md = myMonthDay();
  if (!md) {
    return { month: null, day: null, show: state.show, minor: false, canEdit: false, wishes: [], wishCount: 0, thankPending: 0, giftReady: false, giftOpened: false };
  }
  const today = isToday();
  return {
    month: md.month,
    day: md.day,
    show: state.show,
    minor: false,
    giftReady: today && !state.giftOpened,
    giftOpened: today && state.giftOpened,
    wishCount: today ? RECEIVED.length : 0,
    thankPending: today && !state.thanked ? RECEIVED.length : 0,
    wishes: today ? RECEIVED : [],
    canEdit: !state.edited,
  };
};

const row = (p) => ({
  uid: p.uid,
  name: p.name,
  avatar: p.avatar,
  ...monthDayIn(p.offset),
  wishes: p.wishes + (state.wished.has(p.uid) ? 1 : 0),
  wished: state.wished.has(p.uid),
  reason: p.reason || null,
});

const mock = {
  /** 'today' | 'soon' | 'later' | 'none' */
  setPreview(which) {
    state.preview = which;
    state.giftOpened = false;
    state.thanked = false;
    state.edited = null;
    state.added = null;
  },
  getPreview: () => state.preview,

  // RTDB stand-ins (birthdayApi reads these directly when the mock is on).
  ownBirthday() {
    const md = myMonthDay();
    return { dob: md ? `${new Date().getFullYear() - 20}-${pad2(md.month)}-${pad2(md.day)}` : null, show: state.show };
  },
  todayCount: () => PLAYERS.filter((p) => p.offset === 0).length,
  setShow(show) { state.show = !!show; },
  addBirthday(dob) { state.added = dob; },

  // functions/birthdays endpoints.
  async myBirthday() {
    return wait(mine());
  },

  async birthdayTop({ limit = 6 } = {}) {
    const today = PLAYERS.filter((p) => p.offset === 0)
      .sort((a, b) => (RANK[b.reason] || 0) - (RANK[a.reason] || 0));
    return wait({
      rows: today.slice(0, limit).map(row),
      total: today.length,
      unwished: today.filter((p) => !state.wished.has(p.uid)).length,
      tomorrow: PLAYERS.filter((p) => p.offset === 1).length,
    }, limit > 6 ? 700 : 500);
  },

  async sendBirthdayWish({ to }) {
    const p = PLAYERS.find((x) => x.uid === to);
    if (!p) fail('cannot_wish');
    if (p.offset !== 0) fail('not_today');
    if (state.wished.has(to)) fail('already_wished');
    state.wished.add(to);
    return wait({ wishes: p.wishes + 1 }, 600);
  },

  async wishAllBirthdays() {
    const todo = PLAYERS.filter((p) => p.offset === 0 && !state.wished.has(p.uid));
    todo.forEach((p) => state.wished.add(p.uid));
    return wait({ sent: todo.length, left: 0, limited: false }, 900);
  },

  async thankBirthdayWishers() {
    if (!isToday()) fail('not_today');
    const n = state.thanked ? 0 : RECEIVED.length;
    state.thanked = true;
    return wait({ thanked: n }, 600);
  },

  async claimBirthdayGift() {
    if (!isToday() || state.giftOpened) fail('gift_unavailable');
    state.giftOpened = true;
    return wait({ stars: 15 });
  },

  async updateMyBirthday({ month, day }) {
    if (state.edited) fail('already_edited');
    state.edited = { month, day };
    return wait({ month, day });
  },
};

export default mock;
