/**
 * TradeAdvisorScreen — "What can I get?" (2026-11-20).
 *
 * The player taps items from My Stuff (or searches any item), and the screen
 * lists single items and two-item swaps of about the same value, with a
 * win / fair / loss label and demand. "Add to goals" puts a suggestion in My
 * Goals, which is what Trade Match uses to find players who have it.
 *
 * All math is on the phone (advisorCore.js) over the value list the player
 * picked. Opened from My Stuff ▸ My Items.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image,
} from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { doc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import {
  buildItemPool, unwrapFeed, priceOf, isSummable, isTradeBlocked, poolLookup,
  resolveItemImage, categoryKey, VALUE_SOURCE, DEFAULT_VALUE_SOURCE,
} from '../Helper/valueSources';
import { matchesItemName } from '../Helper/itemSearch';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { adviseTrade } from './advisorCore';

const VERDICT = {
  win: { color: '#10B981', key: 'advisor.verdict_win', fallback: 'Win' },
  fair: { color: '#F59E0B', key: 'advisor.verdict_fair', fallback: 'Fair' },
  loss: { color: '#EF4444', key: 'advisor.verdict_loss', fallback: 'Small loss' },
};

// Exact below 100K: rounding 1,850 and 1,950 both to "1.9K" made a
// "Small loss" label look wrong next to the same number as the offer.
const fmt = (v) => {
  if (!v || typeof v !== 'number') return '0';
  const smart = (n, u) => { const s = n.toFixed(1); return (s.endsWith('.0') ? n.toFixed(0) : s) + u; };
  if (v >= 1e9) return smart(v / 1e9, 'B');
  if (v >= 1e6) return smart(v / 1e6, 'M');
  if (v >= 1e5) return smart(v / 1e3, 'K');
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toLocaleString() : v.toFixed(1);
};

const parseFeed = (raw) => {
  try {
    if (!raw) return null;
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return p && typeof p === 'object' ? unwrapFeed(p) : null;
  } catch { return null; }
};

const sameItem = (a, b) => (a?.id && b?.id && a.id === b.id)
  || (String(a?.name || '').toLowerCase() === String(b?.name || '').toLowerCase()
    && categoryKey(a?.category) === categoryKey(b?.category));

const TradeAdvisorScreen = () => {
  const { user, firestoreDB } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const C = useThemeColors();
  const { t } = useTranslation();
  const navigation = useNavigation();

  const valueSource = localState?.valueSource || DEFAULT_VALUE_SOURCE;
  const pool = useMemo(
    () => buildItemPool(parseFeed(localState?.data), parseFeed(localState?.suprime)),
    [localState?.data, localState?.suprime],
  );
  const lookup = useMemo(() => poolLookup(pool), [pool]);

  // Priced, tradable single items. Sets are bundles, so they are left out of
  // suggestions; award trophies cannot change hands (isTradeBlocked).
  const priceRow = useCallback((row) => {
    const p = priceOf(row, valueSource);
    return {
      key: row.id || `${row.category}|${row.name}`,
      name: row.name,
      value: isSummable(p) ? (p.value || 0) : 0,
      demand: Number.isFinite(row.demand) ? row.demand : null,
      row,
    };
  }, [valueSource]);

  const candidates = useMemo(() => pool
    .filter((r) => !isTradeBlocked(r) && categoryKey(r.category) !== 'SETS')
    .map(priceRow)
    .filter((c) => c.value > 0), [pool, priceRow]);

  // My Stuff items, each resolved to its pool row so it is priced from the
  // list the player picked (the saved value may be from the other list).
  const owned = useMemo(() => (Array.isArray(localState?.ownedPets) ? localState.ownedPets : [])
    .map((it, i) => {
      const row = lookup(it);
      return row ? { i, ...priceRow(row) } : null;
    })
    .filter(Boolean), [localState?.ownedPets, lookup, priceRow]);

  const [picked, setPicked] = useState(() => new Set());
  const [extras, setExtras] = useState([]);

  // Opened from the calculator or an item's detail sheet with params
  // { items: [{ name, category }] }: those start as the offer. Applied once
  // per navigation (the params object identity), after the pool has loaded.
  const route = useRoute();
  const preset = route?.params?.items;
  const [presetDone, setPresetDone] = useState(null);
  useEffect(() => {
    if (!Array.isArray(preset) || !preset.length || presetDone === preset || !pool.length) return;
    // An item that is also in My Stuff selects that chip instead of showing
    // twice (once per copy owned); the rest are added as extra chips.
    const rows = preset.map((it) => lookup(it)).filter(Boolean);
    const pick = new Set();
    const extra = [];
    rows.forEach((row) => {
      const key = priceRow(row).key;
      const mine = owned.find((o) => o.key === key && !pick.has(o.i));
      if (mine) pick.add(mine.i); else extra.push(row);
    });
    setPicked(pick);
    setExtras(extra);
    setPresetDone(preset);
  }, [preset, presetDone, pool.length, lookup, owned, priceRow]);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState(() => new Set());

  // A real My Stuff change shifts indices, so the pick starts over. Keyed on
  // the items, not the array: saving a goal re-reads the whole reviews doc
  // into a new ownedPets array with the same items, which used to clear it.
  // Not on first render, which would undo items picked from the calculator.
  const ownedSignature = owned.map((o) => o.key).join('|');
  const lastSignature = useRef(null);
  useEffect(() => {
    if (lastSignature.current !== null && lastSignature.current !== ownedSignature) setPicked(new Set());
    lastSignature.current = ownedSignature;
  }, [ownedSignature]);

  const offer = useMemo(() => [
    ...owned.filter((o) => picked.has(o.i)),
    ...extras.map((row) => priceRow(row)),
  ], [owned, picked, extras, priceRow]);

  const result = useMemo(() => adviseTrade(offer, candidates), [offer, candidates]);

  // ── Usage events (GA4 via trackGrowthEvent). Counts and labels only, never
  // item names. Every event carries `entry`: which button opened the screen
  // (mystuff, home_card, more, calculator, item_sheet). Owner, 2026-11-20:
  // track whether people use the advisor (MM2 only for now).
  const entry = route?.params?.entry || 'unknown';
  const track = useCallback((name, params = {}) => trackGrowthEvent(name, { entry, ...params }), [entry]);
  const stats = useRef({ openedAt: Date.now(), results: 0, goals: 0 });

  // Once per visit; switching the value list is its own event below.
  useEffect(() => {
    track('advisor_view', { source: valueSource });
    const s0 = stats.current;
    return () => track('advisor_close', {
      seconds: Math.round((Date.now() - s0.openedAt) / 1000),
      results: s0.results,
      goals: s0.goals,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once per change of the offer (not per render).
  useEffect(() => {
    if (!result.total) return;
    stats.current.results += 1;
    const found = result.singles.length + result.combos.length;
    track('advisor_result', {
      source: valueSource,
      offer_items: offer.length,
      singles: result.singles.length,
      combos: result.combos.length,
      has_results: found > 0 ? 1 : 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.total, valueSource]);

  const searchHits = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    return candidates.filter((c) => matchesItemName(c.name, q, true)).slice(0, 8);
  }, [query, candidates]);

  const togglePick = (i) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const addToGoals = useCallback(async (rows) => {
    if (!user?.id || !firestoreDB) {
      showErrorMessage(t('advisor.sign_in_goals', { defaultValue: 'Sign in to save goals.' }));
      return;
    }
    const current = Array.isArray(localState?.wishlistPets) ? localState.wishlistPets : [];
    const fresh = rows
      .map(({ row }) => {
        const p = priceOf(row, valueSource);
        return {
          Name: row.name,
          name: row.name,
          value: p.value || 0,
          imageUrl: resolveItemImage(row),
          category: row.type || row.category,
          id: row.id,
          valueSource,
          valueConfidence: p.valueConfidence || null,
          valueText: p.valueText || null,
        };
      })
      .filter((it) => !current.some((g) => sameItem(g, it)));
    const keys = rows.map((r) => r.key);
    if (fresh.length) {
      const next = [...current, ...fresh];
      try {
        await setDoc(doc(firestoreDB, 'reviews', user.id),
          { wishlistPets: next, updatedAt: serverTimestamp() }, { merge: true });
        updateLocalState('wishlistPets', next);
      } catch (e) {
        showErrorMessage(t('advisor.goal_failed', { defaultValue: 'Could not save that goal. Try again.' }), e?.message || '');
        return;
      }
      stats.current.goals += 1;
      track('advisor_goal_add', { items: fresh.length, kind: rows.length > 1 ? 'combo' : 'single' });
    }
    setAdded((prev) => new Set([...prev, ...keys]));
    showSuccessMessage(
      t('advisor.goal_added', { defaultValue: 'Added to My Goals' }),
      t('advisor.goal_added_hint', { defaultValue: 'Trade Match will look for players who have it.' }),
    );
  }, [user?.id, firestoreDB, localState?.wishlistPets, valueSource, updateLocalState, t, track]);

  const renderSuggestion = (s, idx) => {
    const v = VERDICT[s.verdict] || VERDICT.fair;
    const inGoals = s.items.every((it) => added.has(it.key));
    return (
      <View key={`${s.items.map((i) => i.key).join('+')}-${idx}`} style={[$.card, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
        <View style={$.cardTop}>
          <View style={$.imgs}>
            {s.items.map((it) => (
              <Image key={it.key} resizeMethod="resize" resizeMode="contain"
                source={{ uri: resolveItemImage(it.row) || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                style={$.img} />
            ))}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[$.name, { color: C.text }]} numberOfLines={2}>{s.items.map((i) => i.name).join(' + ')}</Text>
            <Text style={[$.meta, { color: C.textSecondary }]} numberOfLines={1}>
              {fmt(s.value)}
              {Number.isFinite(s.demand) ? ` · ${t('advisor.demand', { value: s.demand, defaultValue: 'Demand {{value}}/10' })}` : ''}
            </Text>
          </View>
          <View style={[$.pill, { backgroundColor: v.color + '22' }]}>
            <Text style={[$.pillText, { color: v.color }]}>{t(v.key, { defaultValue: v.fallback })}</Text>
          </View>
        </View>
        <View style={$.actions}>
          <TouchableOpacity
            onPress={() => addToGoals(s.items)}
            disabled={inGoals}
            style={[$.actBtn, { borderColor: config.colors.primary + '60' }, inGoals && { opacity: 0.6 }]}
            activeOpacity={0.7}
          >
            <FontAwesome name={inGoals ? 'check' : 'bullseye'} size={11} color={config.colors.primary} />
            <Text style={[$.actText, { color: config.colors.primary }]}>
              {inGoals ? t('advisor.in_goals', { defaultValue: 'In My Goals' }) : t('advisor.add_goal', { defaultValue: 'Add to goals' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              track('advisor_find_players', { kind: s.items.length > 1 ? 'combo' : 'single' });
              navigation.navigate('TradeMatch');
            }}
            style={[$.actBtn, { borderColor: C.border }]}
            activeOpacity={0.7}
          >
            <FontAwesome name="user-group" size={11} color={C.textSecondary} />
            <Text style={[$.actText, { color: C.textSecondary }]}>{t('advisor.find_players', { defaultValue: 'Find players' })}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const nothingPicked = offer.length === 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={$.content} keyboardShouldPersistTaps="handled">
      {/* Which value list the numbers come from — the same toggle as the calculator */}
      <View style={$.sourceRow}>
        <Text style={[$.label, { color: C.textSecondary, marginBottom: 0 }]}>{t('advisor.values_from', { defaultValue: 'Values from' })}</Text>
        {[VALUE_SOURCE.SUPREME, VALUE_SOURCE.MM2].map((src) => {
          const on = valueSource === src;
          return (
            <TouchableOpacity key={src} onPress={() => { if (on) return; track('advisor_source_switch', { to: src }); updateLocalState('valueSource', src); }}
              style={[$.chip, on ? { backgroundColor: config.colors.primary, borderColor: config.colors.primary } : { borderColor: C.border }]}
              accessibilityRole="radio" accessibilityState={{ checked: on }}>
              <Text style={[$.chipText, { color: on ? '#fff' : C.text }]}>{src === VALUE_SOURCE.MM2 ? 'MM2' : 'Supreme'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[$.label, { color: C.textSecondary }]}>
        {t('advisor.pick_items', { defaultValue: 'Tap the items you would trade' })}
      </Text>
      {owned.length === 0 ? (
        <Text style={[$.hint, { color: C.textSecondary }]}>
          {t('advisor.no_items', { defaultValue: 'Your My Stuff list is empty. Search for an item below.' })}
        </Text>
      ) : (
        <View style={$.wrap}>
          {owned.map((o) => {
            const on = picked.has(o.i);
            return (
              <TouchableOpacity key={`own-${o.i}`} onPress={() => togglePick(o.i)}
                style={[$.chip, on ? { backgroundColor: config.colors.primary + '1F', borderColor: config.colors.primary } : { borderColor: C.border }]}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                {on && <FontAwesome name="check" size={10} color={config.colors.primary} />}
                <Text style={[$.chipText, { color: on ? config.colors.primary : C.text }]} numberOfLines={1}>{o.name}</Text>
                <Text style={[$.chipVal, { color: C.textSecondary }]}>{fmt(o.value)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {extras.length > 0 && (
        <View style={$.wrap}>
          {extras.map((row, i) => (
            <TouchableOpacity key={`x-${i}`} onPress={() => setExtras((prev) => prev.filter((_, k) => k !== i))}
              style={[$.chip, { backgroundColor: config.colors.primary + '1F', borderColor: config.colors.primary }]}>
              <Text style={[$.chipText, { color: config.colors.primary }]} numberOfLines={1}>{row.name}</Text>
              <FontAwesome name="xmark" size={10} color={config.colors.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('advisor.search_placeholder', { defaultValue: 'Add another item, e.g. Sunset' })}
        placeholderTextColor={C.textSecondary}
        style={[$.search, { color: C.text, backgroundColor: C.bgAlt, borderColor: C.border }]}
        autoCorrect={false}
      />
      {searchHits.map((c) => (
        <TouchableOpacity key={`hit-${c.key}`} onPress={() => { track('advisor_search_add'); setExtras((prev) => [...prev, c.row]); setQuery(''); }}
          style={[$.hit, { borderColor: C.border }]}>
          <Text style={[$.chipText, { color: C.text, flex: 1 }]} numberOfLines={1}>{c.name}</Text>
          <Text style={[$.chipVal, { color: C.textSecondary }]}>{fmt(c.value)}</Text>
          <FontAwesome name="plus" size={11} color={config.colors.primary} />
        </TouchableOpacity>
      ))}

      <View style={[$.total, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
        <Text style={[$.label, { color: C.textSecondary, marginBottom: 0 }]}>{t('advisor.your_offer', { defaultValue: 'Your offer' })}</Text>
        <Text style={[$.totalVal, { color: C.text }]}>{fmt(result.total)}</Text>
      </View>

      {nothingPicked ? (
        <Text style={[$.hint, { color: C.textSecondary, textAlign: 'center', marginTop: 16 }]}>
          {t('advisor.empty', { defaultValue: 'Pick at least one item to see what you can get.' })}
        </Text>
      ) : (
        <>
          <Text style={[$.section, { color: C.text }]}>{t('advisor.swap_one', { defaultValue: 'Swap for one item' })}</Text>
          {result.singles.length
            ? result.singles.map(renderSuggestion)
            : <Text style={[$.hint, { color: C.textSecondary }]}>{t('advisor.none_single', { defaultValue: 'No single item is close in value.' })}</Text>}
          <Text style={[$.section, { color: C.text }]}>{t('advisor.swap_two', { defaultValue: 'Or two items' })}</Text>
          {result.combos.length
            ? result.combos.map(renderSuggestion)
            : <Text style={[$.hint, { color: C.textSecondary }]}>{t('advisor.none_combo', { defaultValue: 'No two-item swap is close in value.' })}</Text>}
          <Text style={[$.note, { color: C.textSecondary }]}>
            {t('advisor.note', {
              source: valueSource === VALUE_SOURCE.MM2 ? 'MM2' : 'Supreme',
              defaultValue: 'Based on {{source}} values. Values change, so check both sides before you trade.',
            })}
          </Text>
        </>
      )}
    </ScrollView>
  );
};

const $ = StyleSheet.create({
  content: { padding: 16, paddingBottom: 60 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  hint: { fontSize: 12, lineHeight: 17 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, maxWidth: '100%' },
  chipText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  chipVal: { fontSize: 11, fontWeight: '600' },
  search: { height: 40, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 13, marginTop: 4, marginBottom: 4 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  totalVal: { fontSize: 20, fontWeight: '900' },
  section: { fontSize: 14, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  imgs: { flexDirection: 'row', gap: 2 },
  img: { width: 40, height: 40, borderRadius: 8 },
  name: { fontSize: 13, fontWeight: '700' },
  meta: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillText: { fontSize: 11, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  actText: { fontSize: 12, fontWeight: '700' },
  note: { fontSize: 11, marginTop: 12, lineHeight: 15 },
});

export default TradeAdvisorScreen;
