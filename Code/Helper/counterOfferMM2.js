// MM2 glue for the shared counter offer (Code/CounterOffer/counterOffer.js,
// 2026-11-05, features LOG "Counter offer"). Everything MM2-specific lives
// here so the shared folder stays identical across the three apps.
//
// ── Where it lives (RTDB, not Supabase) ────────────────────────────────────
// MM2 DMs are Realtime Database rows at
//   private_messages/{chatKey}/messages/{timestampKey}
//   { text, senderId, timestamp, origin, imageUrl?, imageUrls?, fruits?, replyTo? }
// The offer message adds one child, `tradeOffer` (the shared payload), and
// carries the readable fallback in `text`. Older builds render only `text`
// and ignore unknown children, so they show the one-line fallback.
//
// ── Why status changes are reply messages ─────────────────────────────────
// database.rules.json validates every write under messages/$msgId with
// `newData.child('senderId').val() === auth.uid`, so the RECEIVER cannot
// write the sender's message (not even one child). Instead every status
// change — by either side — is a small new message:
//   { text: '✅ Accepted the counter offer', offerStatus: { offerId, msgId, action } }
// and the card's status is the fold of those replies over the offer
// (foldOfferStatuses). One event log, so both phones reach the same answer
// (earliest valid action wins a race), old builds read the text, and every
// change gets the normal unread count + inbox preview.
import {
  isTradeOffer,
  canApplyOfferAction,
  applyOfferAction,
  OFFER_ACTION,
} from '../CounterOffer/counterOffer';

/**
 * MM2 has no variant flags (Chroma etc. are their own catalogue rows), so the
 * "variant" slot only carries what the card and catalogue lookup need: the
 * category, and whether the item had no price in the source that priced it.
 * Callers set `offerUnpriced` on the slot before buildTradeOffer.
 */
export const mm2VariantOf = (item) => ({
  type: item?.type || item?.category || item?.Category || item?.Type || null,
  ...(item?.offerUnpriced ? { unpriced: true } : {}),
});

/** No variant prefix in MM2 names. */
export const mm2VariantText = () => '';

const ACTIONS = new Set(Object.values(OFFER_ACTION));

export const isOfferStatusReply = (x) =>
  !!x && typeof x === 'object' && !Array.isArray(x)
  && typeof x.offerId === 'string' && ACTIONS.has(x.action);

export const buildOfferStatusReply = ({ offerId, msgId, action }) => ({
  offerId: String(offerId),
  msgId: msgId != null ? String(msgId) : null,
  action,
});

const REPLY_TEXT = {
  [OFFER_ACTION.ACCEPT]: ['reply_accept', '✅ Accepted the counter offer'],
  [OFFER_ACTION.DECLINE]: ['reply_decline', '❌ Declined the counter offer'],
  [OFFER_ACTION.CANCEL]: ['reply_cancel', '↩️ Cancelled the counter offer'],
  [OFFER_ACTION.COMPLETE]: ['reply_complete', '🤝 Marked the trade as completed'],
  [OFFER_ACTION.FAIL]: ['reply_fail', "⚠️ Marked the trade as didn't happen"],
};

/** The status reply's text, in the given t's language. */
export const offerStatusReplyText = (action, t) => {
  const [key, fallback] = REPLY_TEXT[action] || REPLY_TEXT[OFFER_ACTION.ACCEPT];
  return t(`counter_offer.${key}`, { defaultValue: fallback });
};

/** Unpriced items in an offer (both sides). */
export const offerUnpricedCount = (offer) =>
  [...(offer?.give || []), ...(offer?.get || [])].filter((i) => i && i.unpriced).length;

/**
 * Apply every status reply to its offer. `messages` is the screen's list in
 * any order; returns the same array when nothing changes, and otherwise the
 * same row objects except offer rows whose status moved (new objects with the
 * folded `tradeOffer`). Replies are taken oldest first; one that is not valid
 * for the state at that moment (a race, a stale screen) is ignored.
 */
export const foldOfferStatuses = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const offers = new Map(); // offerId -> { msg, state }
  messages.forEach((m) => {
    if (m && isTradeOffer(m.tradeOffer) && m.tradeOffer.id) {
      offers.set(String(m.tradeOffer.id), { msg: m, state: m.tradeOffer });
    }
  });
  if (offers.size === 0) return messages;

  const events = messages
    .filter((m) => m && isOfferStatusReply(m.offerStatus) && offers.has(m.offerStatus.offerId))
    .sort((a, b) => ((a.timestamp || 0) - (b.timestamp || 0)) || String(a.id).localeCompare(String(b.id)));
  if (events.length === 0) return messages;

  events.forEach((ev) => {
    const o = offers.get(ev.offerStatus.offerId);
    const viewerIsSender = ev.senderId === o.msg.senderId;
    if (canApplyOfferAction(o.state, ev.offerStatus.action, viewerIsSender)) {
      o.state = applyOfferAction(o.state, ev.offerStatus.action, ev.senderId || null, ev.timestamp || 0);
    }
  });

  let changed = false;
  const out = messages.map((m) => {
    if (!m || !isTradeOffer(m.tradeOffer)) return m;
    const o = offers.get(String(m.tradeOffer.id));
    if (!o || o.msg !== m || o.state === m.tradeOffer) return m;
    changed = true;
    return { ...m, tradeOffer: o.state };
  });
  return changed ? out : messages;
};
