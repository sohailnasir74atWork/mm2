/**
 * TradeCompletion.js
 * Modal for logging completed trades after calculating them.
 *
 * Flow:
 * 1. User finishes calculating a trade on the calculator (HomeScreen)
 * 2. Taps "Log Trade"
 * 3. Modal asks: rate the trade (Win/Fair/Loss) + optional note
 * 4. Trade saved to Firestore trade_journal/{uid}/trades → XP awarded
 * 5. Optionally updates My Stuff: removes what you gave, adds what you got
 *
 * The saved entry is what the My Stuff → History tab and the Trade Journal
 * screen read back.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, TextInput,
  ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { doc, getDoc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import config from '../Helper/Environment';
import { useThemeColors } from '../Helper/themeColors';
import { useLocalState } from '../LocalGlobelStats';
import { addJournalEntry, slimItem } from './journalUtils';
import { addXP, XP_ACTIONS } from './xpUtils';

const TRADE_RATINGS = [
  { key: 'win',  label: 'Win',  emoji: '🏆', color: '#10B981', desc: 'I got more value' },
  { key: 'fair', label: 'Fair', emoji: '🤝', color: '#F59E0B', desc: 'Equal trade' },
  { key: 'loss', label: 'Loss', emoji: '📉', color: '#EF4444', desc: 'I gave more value' },
];

// The calculator says 'lose'; the journal and these cards use 'loss'.
const normalizeResult = (r) => (r === 'lose' ? 'loss' : r);

const sumValues = (items) =>
  items.reduce((s, i) => s + (Number(i?.Value ?? i?.value) || 0), 0);

const TradeCompletion = ({
  visible,
  onClose,
  db,             // RTDB handle — XP
  firestoreDB,
  uid,
  hasItems = [],
  wantsItems = [],
  tradeResult = 'fair',
  t,
}) => {
  const C = useThemeColors();
  const { updateLocalState } = useLocalState();

  const [selectedRating, setSelectedRating] = useState(normalizeResult(tradeResult));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncInventory, setSyncInventory] = useState(true);
  const [inventoryMsg, setInventoryMsg] = useState('');

  // Keep the preselected rating in step with the calculator while the modal is
  // closed; once it's open the user's own choice wins.
  useEffect(() => {
    if (!visible) setSelectedRating(normalizeResult(tradeResult));
  }, [tradeResult, visible]);

  const tr = useCallback(
    (key, fallback) => (typeof t === 'function' ? t(key, { defaultValue: fallback }) : fallback),
    [t]
  );

  const gave = hasItems.filter(Boolean);
  const got = wantsItems.filter(Boolean);
  const gaveValue = sumValues(gave);
  const gotValue = sumValues(got);

  // Reports whether anything was actually saved, so the caller only runs its
  // post-log flow (reset calculator, toast, ad) on a real save — not on a
  // plain dismissal.
  const handleClose = useCallback(() => {
    const didSave = saved;
    setSaved(false);
    setNotes('');
    setInventoryMsg('');
    setSaving(false);
    onClose?.(didSave);
  }, [onClose, saved]);

  /**
   * Move traded items through My Stuff: drop each given item, add each received
   * one. Best-effort — a failure here must not lose the journal entry, so it is
   * called after the entry is written and its errors are swallowed.
   */
  const applyInventory = useCallback(async () => {
    if (!firestoreDB || !uid) return '';
    const removed = [];
    const notOwned = [];
    const added = [];

    const snap = await getDoc(doc(firestoreDB, 'reviews', uid));
    const owned = snap.exists() && Array.isArray(snap.data()?.ownedPets)
      ? [...snap.data().ownedPets]
      : [];

    gave.forEach((g) => {
      const s = slimItem(g);
      const key = s.name.toLowerCase();
      // Prefer an exact name+type match so trading a Chroma never removes the
      // Godly of the same name; fall back to name-only when unambiguous.
      let idx = owned.findIndex(p =>
        (p?.name || '').toLowerCase() === key &&
        (p?.type || '') === (s.type || '')
      );
      if (idx === -1) {
        const sameName = owned.filter(p => (p?.name || '').toLowerCase() === key);
        if (sameName.length === 1) idx = owned.indexOf(sameName[0]);
      }
      if (idx !== -1) { owned.splice(idx, 1); removed.push(s.name); }
      else notOwned.push(s.name);
    });

    got.forEach((g) => {
      const s = slimItem(g);
      owned.push({
        name: s.name,
        type: s.type,
        value: s.value,
        image: s.image,
        imageUrl: s.image, // My Stuff renders imageUrl
        addedAt: new Date().toISOString(),
        addedVia: 'trade',
      });
      added.push(s.name);
    });

    await setDoc(
      doc(firestoreDB, 'reviews', uid),
      { ownedPets: owned, updatedAt: serverTimestamp() },
      { merge: true }
    );
    // Mirror to MMKV so the calculator's INVENTORY tab and My Stuff show the
    // post-trade list immediately instead of after a restart.
    updateLocalState('ownedPets', owned);

    let msg = '';
    if (added.length) msg += `✅ ${tr('trade_log.added', 'Added')}: ${added.join(', ')}\n`;
    if (removed.length) msg += `🔄 ${tr('trade_log.removed', 'Removed')}: ${removed.join(', ')}\n`;
    if (notOwned.length) msg += `⚠️ ${tr('trade_log.not_in_list', 'Not in My Stuff')}: ${notOwned.join(', ')}`;
    return msg.trim();
  }, [firestoreDB, uid, gave, got, updateLocalState, tr]);

  const handleSave = useCallback(async () => {
    if (!uid || !firestoreDB) {
      Alert.alert(tr('trade_log.signin_title', 'Sign in first'), tr('trade_log.signin_msg', 'You need an account to log trades.'));
      return;
    }
    if (gave.length === 0 && got.length === 0) {
      Alert.alert(
        tr('trade_log.empty_title', 'Add items first'),
        tr('trade_log.empty_msg', 'Put items on at least one side before logging a trade.')
      );
      return;
    }
    setSaving(true);
    try {
      await addJournalEntry(firestoreDB, uid, {
        givenItems: gave,
        receivedItems: got,
        givenValue: gaveValue,
        receivedValue: gotValue,
        result: selectedRating,
        note: notes,
      });

      // Fire-and-forget — XP must never block or fail the log.
      if (db) addXP(db, uid, XP_ACTIONS.COMPLETE_TRADE);

      let msg = `+${XP_ACTIONS.COMPLETE_TRADE} XP`;
      if (syncInventory) {
        try {
          const invMsg = await applyInventory();
          if (invMsg) msg += `\n${invMsg}`;
        } catch (e) {
          console.warn('[TradeCompletion] inventory sync failed:', e?.message);
          msg += `\n⚠️ ${tr('trade_log.inv_failed', 'Could not update My Stuff — the trade was still logged.')}`;
        }
      }
      setInventoryMsg(msg);
      setSaved(true);
    } catch (err) {
      console.warn('[TradeCompletion] save error:', err?.message);
      Alert.alert(tr('trade_log.error', 'Error'), err?.message || tr('trade_log.error_msg', 'Could not save trade. Try again.'));
    } finally {
      setSaving(false);
    }
  }, [uid, firestoreDB, db, gave, got, gaveValue, gotValue, selectedRating, notes, syncInventory, applyInventory, tr]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={$.overlay}>
        <View style={[$.sheet, { backgroundColor: C.bg }]}>
          <View style={$.grabber} />

          {saved ? (
            /* ── Success ── */
            <View style={$.successWrap}>
              <Text style={{ fontSize: 48 }}>🎉</Text>
              <Text style={[$.successTitle, { color: C.text }]}>
                {tr('trade_log.saved_title', 'Trade Logged!')}
              </Text>
              <Text style={[$.successSub, { color: C.textSecondary }]}>{inventoryMsg}</Text>
              <TouchableOpacity style={$.doneBtn} onPress={handleClose} activeOpacity={0.85}>
                <Text style={$.doneBtnText}>{tr('trade_log.done', 'Done')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* ── Header ── */}
              <View style={$.header}>
                <Text style={[$.title, { color: C.text }]}>
                  📓 {tr('trade_log.title', 'I Traded!')}
                </Text>
                <TouchableOpacity onPress={handleClose} style={$.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <FontAwesome name="xmark" size={16} color={C.textSecondary} solid />
                </TouchableOpacity>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {/* ── Summary ── */}
                <View style={[$.summary, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[$.sideLabel, { color: '#EF4444' }]}>{tr('trade_log.i_gave', 'I Gave')}</Text>
                    <Text style={[$.sideCount, { color: C.text }]}>
                      {gave.length} {tr('trade_log.items', 'item(s)')}
                    </Text>
                  </View>
                  <FontAwesome name="right-left" size={14} color={C.textSecondary} solid />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={[$.sideLabel, { color: '#10B981' }]}>{tr('trade_log.i_got', 'I Got')}</Text>
                    <Text style={[$.sideCount, { color: C.text }]}>
                      {got.length} {tr('trade_log.items', 'item(s)')}
                    </Text>
                  </View>
                </View>

                {/* ── Rating ── */}
                <Text style={[$.sectionLabel, { color: C.text }]}>
                  {tr('trade_log.how_did_it_go', 'How did it go?')}
                </Text>
                <View style={$.ratingRow}>
                  {TRADE_RATINGS.map((r) => {
                    const on = selectedRating === r.key;
                    return (
                      <TouchableOpacity
                        key={r.key}
                        onPress={() => setSelectedRating(r.key)}
                        activeOpacity={0.8}
                        style={[
                          $.ratingCard,
                          { backgroundColor: C.bgAlt, borderColor: on ? r.color : C.border },
                          on && { backgroundColor: r.color + '18', borderWidth: 2 },
                        ]}
                      >
                        <Text style={{ fontSize: 22 }}>{r.emoji}</Text>
                        <Text style={[$.ratingLabel, { color: on ? r.color : C.text }]}>
                          {tr(`trade_log.rating_${r.key}`, r.label)}
                        </Text>
                        <Text style={[$.ratingDesc, { color: C.textSecondary }]} numberOfLines={2}>
                          {tr(`trade_log.rating_${r.key}_desc`, r.desc)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* ── Note ── */}
                <TextInput
                  style={[$.input, { backgroundColor: C.bgAlt, borderColor: C.border, color: C.text }]}
                  placeholder={tr('trade_log.note_placeholder', 'Notes (optional)')}
                  placeholderTextColor={C.textSecondary}
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={100}
                  multiline
                />

                {/* ── Inventory sync ── */}
                <TouchableOpacity
                  style={[$.checkRow, { backgroundColor: C.bgAlt, borderColor: C.border }]}
                  onPress={() => setSyncInventory(v => !v)}
                  activeOpacity={0.75}
                >
                  <View style={[
                    $.checkbox,
                    { borderColor: syncInventory ? config.colors.primary : C.border },
                    syncInventory && { backgroundColor: config.colors.primary },
                  ]}>
                    {syncInventory && <FontAwesome name="check" size={9} color="#fff" solid />}
                  </View>
                  <Text style={[$.checkLabel, { color: C.text }]}>
                    {tr('trade_log.sync_inventory', 'Update My Stuff with this trade')}
                  </Text>
                </TouchableOpacity>

                {/* ── Save ── */}
                <TouchableOpacity
                  style={[$.saveBtn, saving && { opacity: 0.7 }]}
                  onPress={handleSave}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {saving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={$.saveBtnText}>{tr('trade_log.save', 'Save to My Stuff ✨')}</Text>}
                </TouchableOpacity>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const $ = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
    maxHeight: '88%',
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.45)',
    alignSelf: 'center', marginBottom: 10,
  },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '900' },
  closeBtn: { padding: 4 },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 16,
  },
  sideLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  sideCount: { fontSize: 14, fontWeight: '700', marginTop: 2 },

  sectionLabel: { fontSize: 14, fontWeight: '800', marginBottom: 10 },
  ratingRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  ratingCard: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, paddingHorizontal: 6,
    borderRadius: 12, borderWidth: 1,
  },
  ratingLabel: { fontSize: 13, fontWeight: '800', marginTop: 4 },
  ratingDesc: { fontSize: 9, fontWeight: '500', textAlign: 'center', marginTop: 2 },

  input: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, minHeight: 62, textAlignVertical: 'top',
    marginBottom: 12,
  },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 16,
  },
  checkbox: {
    width: 18, height: 18, borderRadius: 5, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkLabel: { fontSize: 12, fontWeight: '600', flex: 1 },

  saveBtn: {
    backgroundColor: config.colors.primary,
    borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  successWrap: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 8 },
  successTitle: { fontSize: 20, fontWeight: '900', marginTop: 10 },
  successSub: { fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: 8, lineHeight: 18 },
  doneBtn: {
    backgroundColor: config.colors.primary,
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 44, marginTop: 20,
  },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});

export default TradeCompletion;
