import { buildTradeOffer, OFFER_ACTION, OFFER_STATUS, offerFallbackText } from '../Code/CounterOffer/counterOffer';
import {
  mm2VariantOf,
  mm2VariantText,
  buildOfferStatusReply,
  foldOfferStatuses,
  offerUnpricedCount,
} from '../Code/Helper/counterOfferMM2';

const t = (_key, opts = {}) =>
  String(opts.defaultValue || '').replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));

const item = (name, extra = {}) => ({ name, category: 'GODLY', image: `${name}.png`, selectedValue: 10, ...extra });

const offerMsg = (id, senderId, ts) => ({
  id: String(ts),
  senderId,
  timestamp: ts,
  text: 'fallback',
  tradeOffer: buildTradeOffer({
    id, give: [item('Luger', { offerUnpriced: true })], get: [item('Corrupt')], valueSource: 'supreme', variantOf: mm2VariantOf, now: ts,
  }),
});
const reply = (offerId, senderId, ts, action) => ({
  id: String(ts), senderId, timestamp: ts, text: 'x', offerStatus: buildOfferStatusReply({ offerId, msgId: '1', action }),
});

describe('counterOfferMM2', () => {
  test('MM2 payload: category as type, unpriced flag, no variant prefix', () => {
    const { tradeOffer } = offerMsg('o1', 'a', 1);
    expect(tradeOffer.give[0]).toMatchObject({ name: 'Luger', type: 'GODLY', unpriced: true, value: 10 });
    expect(tradeOffer.get[0].unpriced).toBeUndefined();
    expect(offerUnpricedCount(tradeOffer)).toBe(1);
    expect(offerFallbackText(tradeOffer, t, mm2VariantText)).toContain('I give: Luger');
  });

  test('replies fold into the offer; invalid ones are ignored', () => {
    const msgs = [
      reply('o1', 'a', 4, OFFER_ACTION.COMPLETE), // sender confirms after accept: valid
      reply('o1', 'a', 3, OFFER_ACTION.ACCEPT), // sender cannot accept own offer: ignored
      reply('o1', 'b', 2, OFFER_ACTION.ACCEPT),
      offerMsg('o1', 'a', 1),
    ];
    const out = foldOfferStatuses(msgs);
    const o = out.find((m) => m.tradeOffer).tradeOffer;
    expect(o).toMatchObject({ status: OFFER_STATUS.COMPLETED, statusBy: 'a', statusAt: 4 });
    expect(out[0]).toBe(msgs[0]);
  });

  test('race: earliest valid action wins on both phones', () => {
    const msgs = [reply('o1', 'b', 3, OFFER_ACTION.ACCEPT), reply('o1', 'a', 2, OFFER_ACTION.CANCEL), offerMsg('o1', 'a', 1)];
    expect(foldOfferStatuses(msgs)[2].tradeOffer.status).toBe(OFFER_STATUS.CANCELLED);
  });

  test('no replies → same array', () => {
    const msgs = [offerMsg('o1', 'a', 1), { id: '2', text: 'hi' }];
    expect(foldOfferStatuses(msgs)).toBe(msgs);
  });
});
