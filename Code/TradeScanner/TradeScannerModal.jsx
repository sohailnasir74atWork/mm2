/**
 * MM2 Trade Scanner (2026-11-01): photograph the in-game trade window on a PC
 * screen with the camera, or pick a screenshot;
 * crop it to the trade window (CropBox, required); read the item names printed
 * on the tiles on the device, let the user fix anything, then fill the
 * calculator (HomeScreen) with them.
 *
 * Names: the native text reader (textReader.js). Sides and Chroma / stack
 * counts: tradeMatch.js. The picture never leaves the phone.
 *
 * Compact bottom sheet, calculator-style review: two 3-column sides, one
 * result bar, a fix strip for the tapped item.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Image, ActivityIndicator, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import config from '../Helper/Environment';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { readTextLines } from './textReader';
import CropBox, { FULL_CROP } from './CropBox';
import { buildTrade, normalize } from './tradeMatch';

// No base64: only the native text reader looks at the picture.
const PICK_OPTIONS = { mediaType: 'photo', maxWidth: 2400, maxHeight: 2400, quality: 0.92 };
// The app declares no CAMERA permission, so the system camera needs none.
const CAMERA_OPTIONS = { ...PICK_OPTIONS, maxWidth: 3000, maxHeight: 3000, saveToPhotos: false, cameraType: 'back' };

const WIN = '#29AB87';
const LOSE = '#FF3B30';
const FAIR = '#F5A623';

// Accuracy feedback (2026-11-01). Every pick keeps what the scan said
// (scanned); at "Use in calculator" the picks the user changed or removed
// give an item-level accuracy, and the Yes / No question gives a per-scan
// one. Separate event names (trade_scan_right / trade_scan_wrong) so the
// GA4 event counts alone give the score: right / (right + wrong).
const FEEDBACK_REASONS = [
  ['wrong_item', 'Wrong item'],
  ['amount', 'Wrong amount'],
  ['missed', 'Missed items'],
  ['extra', 'Extra items'],
  ['sides', 'Wrong sides'],
];
const pickKey = (p) => [p.name, p.variant || '', p.fly ? 1 : 0, p.ride ? 1 : 0].join('|');
const withScan = (list) => list.map((p) => ({ ...p, scanned: pickKey(p) }));
const scanStats = (r) => {
  const now = [...r.mine, ...r.theirs];
  const fixed = now.filter((p) => p.scanned !== pickKey(p)).length;
  const removed = Math.max(0, r.found - now.length);
  const kept = now.length - fixed;
  return {
    source: r.source,
    found: r.found,
    fixed,
    removed,
    swapped: r.swapped ? 1 : 0,
    accuracy: r.found ? Math.round((100 * kept) / r.found) : 0,
  };
};

export default function TradeScannerModal({ visible, onClose, onApply, records, maxPerSide, isDarkMode, imageFor, valueFor, verdictFor, formatValue }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [stage, setStage] = useState('intro'); // intro | crop | working | review | none
  const [picked, setPicked] = useState(null); // { asset, source } waiting in the crop step
  const crop = useRef(FULL_CROP);
  const [result, setResult] = useState(null); // { mine: [pick], theirs: [pick], cut }
  const [openPick, setOpenPick] = useState(null); // 'mine:0'
  const [feedback, setFeedback] = useState(null); // null | 'wrong' | 'done'

  const byName = useMemo(() => {
    const map = new Map();
    (records || []).forEach((r) => { if (r?.name) map.set(normalize(r.name), r); });
    return map;
  }, [records]);
  const catalog = useMemo(() => new Map([...byName].map(([k, r]) => [k, r.name])), [byName]);

  useEffect(() => {
    if (!visible) {
      setStage('intro');
      setResult(null);
      setPicked(null);
      setOpenPick(null);
    }
  }, [visible]);

  // source: 'camera' | 'gallery'
  const captureAndScan = useCallback(async (source) => {
    let asset;
    try {
      const res = source === 'camera' ? await launchCamera(CAMERA_OPTIONS) : await launchImageLibrary({ ...PICK_OPTIONS, selectionLimit: 1 });
      if (res.didCancel || res.errorCode) return;
      asset = res.assets?.[0];
    } catch {
      return;
    }
    if (!asset?.uri) return;
    // Always through the crop step: extra things around the trade window
    // are what give wrong items.
    crop.current = FULL_CROP;
    setPicked({ asset, source });
    setOpenPick(null);
    setStage('crop');
  }, []);

  const scanCropped = useCallback(async () => {
    if (!picked) return;
    const { asset, source } = picked;
    const frame = crop.current;
    setStage('working');
    const text = await readTextLines(asset.uri, frame);
    const trade = buildTrade({ lines: text.lines, width: text.width || (asset.width || 1000) * frame.w, catalog });
    const all = [...trade.mine, ...trade.theirs];
    trackGrowthEvent('trade_scan', {
      source,
      window: trade.foundWindow ? 1 : 0,
      found: all.length,
      unsure: all.filter((p) => !p.sure).length,
      text_reader: text.ok ? 1 : 0,
      crop_area: Math.round(frame.w * frame.h * 100),
    });
    if (!all.length) { setStage('none'); return; }
    setResult({
      mine: withScan(trade.mine.slice(0, maxPerSide)),
      theirs: withScan(trade.theirs.slice(0, maxPerSide)),
      found: Math.min(trade.mine.length, maxPerSide) + Math.min(trade.theirs.length, maxPerSide),
      source,
      cut: trade.mine.length > maxPerSide || trade.theirs.length > maxPerSide,
    });
    setFeedback(null);
    setStage('review');
  }, [picked, catalog, maxPerSide]);

  const recordOf = useCallback((p) => byName.get(normalize(p.name)), [byName]);
  const pickValue = useCallback((p) => {
    const rec = recordOf(p);
    return rec ? Number(valueFor(rec)) || 0 : 0;
  }, [recordOf, valueFor]);

  const totals = useMemo(() => {
    const sum = (list) => (list || []).reduce((acc, p) => acc + pickValue(p), 0);
    return { mine: sum(result?.mine), theirs: sum(result?.theirs) };
  }, [result, pickValue]);

  const verdict = useMemo(() => {
    if (!result || (!totals.mine && !totals.theirs)) return null;
    // An unchecked guess can swing the total either way: no verdict until
    // every "?" pick is confirmed (tapping a pick and choosing marks it sure).
    const unsure = [...result.mine, ...result.theirs].filter((x) => !x.sure).length;
    if (unsure) return { pct: '', label: `${t('trade_scanner.check', { defaultValue: 'Check' })} ${unsure} ?`, color: '#F5A623' };
    const status = verdictFor(totals.mine, totals.theirs);
    const big = Math.max(totals.mine, totals.theirs);
    const gap = big ? (totals.theirs - totals.mine) / big : 0;
    const pct = `${gap >= 0 ? '+' : ''}${Math.round(gap * 100)}%`;
    if (status === 'win') return { pct, label: t('trade_scanner.win', { defaultValue: 'Win' }), color: WIN };
    if (status === 'lose') return { pct, label: t('trade_scanner.lose', { defaultValue: 'Lose' }), color: LOSE };
    return { pct, label: t('trade_scanner.fair', { defaultValue: 'Fair' }), color: FAIR };
  }, [result, totals, verdictFor, t]);

  const replacePick = (side, index, name) => {
    setResult((prev) => {
      const list = [...prev[side]];
      const old = list[index];
      list[index] = { name, sure: true, scanned: old.scanned, alternatives: [old.name, ...old.alternatives.filter((n) => n !== name)].slice(0, 4) };
      return { ...prev, [side]: list };
    });
  };

  const confirmPick = (side, index) => {
    setResult((prev) => {
      const list = [...prev[side]];
      list[index] = { ...list[index], sure: true };
      return { ...prev, [side]: list };
    });
    setOpenPick(null);
  };

  const removePick = (side, index) => {
    setResult((prev) => ({ ...prev, [side]: prev[side].filter((_, i) => i !== index) }));
    setOpenPick(null);
  };

  const swapSides = () => setResult((prev) => ({ ...prev, mine: prev.theirs, theirs: prev.mine, swapped: !prev.swapped }));

  const vote = (right) => {
    trackGrowthEvent(right ? 'trade_scan_right' : 'trade_scan_wrong', scanStats(result));
    setFeedback(right ? 'done' : 'wrong');
  };

  const voteReason = (reason) => {
    trackGrowthEvent('trade_scan_wrong_reason', { reason, ...scanStats(result) });
    setFeedback('done');
  };

  const apply = () => {
    const toRecords = (list) => list.map(recordOf).filter(Boolean);
    trackGrowthEvent('trade_scan_apply', { mine: result.mine.length, theirs: result.theirs.length, ...scanStats(result) });
    onApply({ mine: toRecords(result.mine), theirs: toRecords(result.theirs) });
  };

  const fg = isDarkMode ? '#fff' : '#1a1a2e';
  const sub = isDarkMode ? '#a0aec0' : '#5a6474';
  const sheet = isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight;
  const card = isDarkMode ? '#1e293b' : '#fff';
  const tileBg = isDarkMode ? '#0f172a' : '#f4f6fa';
  const emptyBorder = isDarkMode ? '#334155' : '#e2e8f0';
  const accent = config.colors.secondary;

  const open = openPick ? { side: openPick.split(':')[0], index: Number(openPick.split(':')[1]) } : null;
  const openItem = open ? result?.[open.side]?.[open.index] : null;

  const sourceButtons = (cameraLabel, galleryLabel) => (
    <View style={styles.sourceRow}>
      <TouchableOpacity style={[styles.btn, styles.grow, { backgroundColor: accent }]} onPress={() => captureAndScan('camera')} activeOpacity={0.8}>
        <Icon name="camera" size={17} color="#fff" />
        <Text style={styles.btnText}>{cameraLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.grow, styles.outline, { borderColor: accent }]} onPress={() => captureAndScan('gallery')} activeOpacity={0.8}>
        <Icon name="image" size={17} color={accent} />
        <Text style={[styles.btnText, { color: accent }]}>{galleryLabel}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderTile = (side, i) => {
    const p = result[side][i];
    const key = `${side}:${i}`;
    if (!p) return <View key={key} style={[styles.tile, styles.tileEmpty, { borderColor: emptyBorder }]} />;
    const rec = recordOf(p);
    const selected = openPick === key;
    const uri = rec ? imageFor(rec) : '';
    return (
      <TouchableOpacity
        key={key}
        style={[styles.tile, { backgroundColor: tileBg, borderColor: selected ? accent : p.sure ? 'transparent' : FAIR }]}
        onPress={() => setOpenPick(selected ? null : key)}
        activeOpacity={0.7}
      >
        {uri ? <Image source={{ uri }} style={styles.tileImage} resizeMethod="resize" /> : null}
        <Text style={[styles.tileName, { color: fg }]} numberOfLines={1}>{p.name}</Text>
        <Text style={[styles.tileValue, { color: accent }]} numberOfLines={1}>{formatValue(pickValue(p))}</Text>
        {!p.sure && (
          <View style={styles.unsure}>
            <Text style={styles.unsureText}>?</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderSide = (side, title, color) => {
    const filled = result[side].length;
    const slots = Math.min(maxPerSide, Math.max(3, Math.ceil(filled / 3) * 3));
    return (
      <View style={[styles.side, { backgroundColor: card }]}>
        <View style={styles.sideHeader}>
          <Text style={[styles.sideTitle, { color }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.sideTotal, { color: fg }]}>{formatValue(totals[side])}</Text>
        </View>
        <View style={styles.grid}>
          {Array.from({ length: slots }, (_, i) => renderTile(side, i))}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: sheet, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Icon name="scan" size={18} color={accent} />
          <Text style={[styles.title, { color: fg }]}>{t('trade_scanner.title', { defaultValue: 'Scan a trade' })}</Text>
          {stage === 'review' && result && (
            <TouchableOpacity onPress={swapSides} style={[styles.swap, { borderColor: accent }]} hitSlop={8}>
              <Icon name="swap-horizontal" size={14} color={accent} />
              <Text style={[styles.swapText, { color: accent }]}>{t('trade_scanner.swap', { defaultValue: 'Swap sides' })}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Icon name="close" size={22} color={sub} />
          </TouchableOpacity>
        </View>

        <View style={styles.beta}>
          <Icon name="flask" size={14} color="#F5A623" />
          <Text style={[styles.betaText, { color: fg }]}>
            {t('trade_scanner.beta', { defaultValue: 'Testing: this scanner is still being tested and can make mistakes. Check every item before you trade.' })}
          </Text>
        </View>

        {(stage === 'intro' || stage === 'none') && (
          <View>
            <View style={[styles.infoRow, { backgroundColor: card }]}>
              <Icon name={stage === 'none' ? 'help-circle' : 'desktop-outline'} size={26} color={stage === 'none' ? FAIR : accent} />
              <Text style={[styles.infoText, { color: fg }]}>
                {stage === 'none'
                  ? t('trade_scanner.none', { defaultValue: 'No trade window found. Fit the whole trade window, with YOUR OFFER and THEIR OFFER, in the photo and try again.' })
                  : t('trade_scanner.intro', { defaultValue: 'Point your camera at the trade window on your PC, or pick a screenshot. We read every item on both offers and check the trade.' })}
              </Text>
            </View>
            <Text style={[styles.note, { color: sub }]}>{t('trade_scanner.camera_tip', { defaultValue: 'Hold steady, fill the photo with the trade window, avoid glare.' })}</Text>
            {sourceButtons(t('trade_scanner.camera', { defaultValue: 'Camera' }), t('trade_scanner.pick', { defaultValue: 'Screenshot' }))}
            <Text style={[styles.note, styles.center, { color: sub }]}>{t('trade_scanner.privacy', { defaultValue: 'Photos are read on your phone and never uploaded.' })}</Text>
          </View>
        )}

        {stage === 'crop' && picked && (
          <View>
            <Text style={[styles.cropTip, { color: fg }]}>
              {t('trade_scanner.crop_tip', { defaultValue: 'Drag the corners around the trade window only: YOUR OFFER and THEIR OFFER. Cut away everything else.' })}
            </Text>
            <CropBox
              uri={picked.asset.uri}
              imageWidth={picked.asset.width}
              imageHeight={picked.asset.height}
              maxHeight={Math.round(screenHeight * 0.5)}
              color={accent}
              onChange={(frame) => { crop.current = frame; }}
            />
            <View style={styles.footer}>
              <TouchableOpacity style={[styles.iconBtn, { borderColor: sub }]} onPress={() => captureAndScan(picked.source)} accessibilityLabel={t('trade_scanner.retake', { defaultValue: 'Pick again' })}>
                <Icon name={picked.source === 'camera' ? 'camera-outline' : 'image-outline'} size={20} color={fg} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.grow, { backgroundColor: accent }]} onPress={scanCropped} activeOpacity={0.8}>
                <Icon name="crop" size={17} color="#fff" />
                <Text style={styles.btnText}>{t('trade_scanner.scan_area', { defaultValue: 'Scan this area' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {stage === 'working' && (
          <View style={styles.working}>
            <ActivityIndicator size="small" color={accent} />
            <Text style={[styles.infoText, styles.noGrow, { color: fg }]}>{t('trade_scanner.working', { defaultValue: 'Reading your trade…' })}</Text>
          </View>
        )}

        {stage === 'review' && result && (
          <View>
            <ScrollView style={styles.sidesScroll} contentContainerStyle={styles.sides} nestedScrollEnabled>
              {renderSide('mine', t('trade_scanner.you_give', { defaultValue: 'You give' }), config.colors.hasBlockGreen)}
              {renderSide('theirs', t('trade_scanner.you_get', { defaultValue: 'You get' }), config.colors.wantBlockRed)}
            </ScrollView>

            {openItem && (
              <View style={[styles.fixRow, { backgroundColor: card }]}>
                <Text style={[styles.fixLabel, { color: sub }]} numberOfLines={1}>{t('trade_scanner.not_right', { defaultValue: 'Not right? Pick:' })}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {!openItem.sure && (
                    <TouchableOpacity style={[styles.chip, { borderColor: '#29AB87' }]} onPress={() => confirmPick(open.side, open.index)}>
                      <Icon name="checkmark" size={14} color="#29AB87" />
                      <Text style={[styles.chipText, { color: '#29AB87' }]}>{t('trade_scanner.correct', { defaultValue: 'Correct' })}</Text>
                    </TouchableOpacity>
                  )}
                  {openItem.alternatives.map((n) => {
                    const rec = byName.get(normalize(n));
                    const uri = rec ? imageFor(rec) : '';
                    return (
                      <TouchableOpacity key={n} style={[styles.chip, { borderColor: sub }]} onPress={() => replacePick(open.side, open.index, n)}>
                        {uri ? <Image source={{ uri }} style={styles.chipImage} resizeMethod="resize" /> : null}
                        <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>{n}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={[styles.chip, { borderColor: LOSE }]} onPress={() => removePick(open.side, open.index)}>
                    <Icon name="trash-outline" size={14} color={LOSE} />
                    <Text style={[styles.chipText, { color: LOSE }]}>{t('trade_scanner.remove', { defaultValue: 'Remove' })}</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            )}

            {verdict && (
              <View style={[styles.result, { backgroundColor: verdict.color }]}>
                <Text style={styles.resultValues} numberOfLines={1}>{formatValue(totals.mine)}  →  {formatValue(totals.theirs)}</Text>
                <Text style={styles.resultVerdict}>{verdict.label} {verdict.pct}</Text>
              </View>
            )}

            <View style={styles.feedback}>
              {feedback === null && (
                <>
                  <Text style={[styles.feedbackText, { color: fg }]} numberOfLines={1}>{t('trade_scanner.feedback_q', { defaultValue: 'Did the scan get it right?' })}</Text>
                  <TouchableOpacity style={[styles.vote, { borderColor: '#29AB87' }]} onPress={() => vote(true)} hitSlop={6}>
                    <Icon name="thumbs-up" size={14} color={'#29AB87'} />
                    <Text style={[styles.voteText, { color: '#29AB87' }]}>{t('trade_scanner.yes', { defaultValue: 'Yes' })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.vote, { borderColor: '#FF3B30' }]} onPress={() => vote(false)} hitSlop={6}>
                    <Icon name="thumbs-down" size={14} color={'#FF3B30'} />
                    <Text style={[styles.voteText, { color: '#FF3B30' }]}>{t('trade_scanner.no', { defaultValue: 'No' })}</Text>
                  </TouchableOpacity>
                </>
              )}
              {feedback === 'wrong' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  <Text style={[styles.feedbackText, { color: fg }]}>{t('trade_scanner.feedback_what', { defaultValue: 'What was wrong?' })}</Text>
                  {FEEDBACK_REASONS.map(([key, label]) => (
                    <TouchableOpacity key={key} style={[styles.vote, { borderColor: sub }]} onPress={() => voteReason(key)}>
                      <Text style={[styles.voteText, { color: fg }]}>{t(`trade_scanner.reason_${key}`, { defaultValue: label })}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {feedback === 'done' && (
                <Text style={[styles.feedbackText, { color: sub }]}>{t('trade_scanner.feedback_thanks', { defaultValue: 'Thanks! This helps us make the scanner better.' })}</Text>
              )}
            </View>

            {(result.cut || !openItem) && (
              <Text style={[styles.note, { color: sub }]} numberOfLines={2}>
                {result.cut
                  ? t('trade_scanner.max_side', { defaultValue: 'Only the first {{max}} items per side fit in the calculator.', max: maxPerSide })
                  : t('trade_scanner.review_tip', { defaultValue: 'YOUR OFFER = you give. Tap an item to fix it.' })}
              </Text>
            )}

            <View style={styles.footer}>
              <TouchableOpacity style={[styles.iconBtn, { borderColor: sub }]} onPress={() => captureAndScan('camera')} accessibilityLabel={t('trade_scanner.camera', { defaultValue: 'Camera' })}>
                <Icon name="camera-outline" size={20} color={fg} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.iconBtn, { borderColor: sub }]} onPress={() => captureAndScan('gallery')} accessibilityLabel={t('trade_scanner.pick', { defaultValue: 'Screenshot' })}>
                <Icon name="image-outline" size={20} color={fg} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.grow, { backgroundColor: accent }]} onPress={apply} activeOpacity={0.8}>
                <Icon name="calculator" size={17} color="#fff" />
                <Text style={styles.btnText}>{t('trade_scanner.use', { defaultValue: 'Use in calculator' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 14, paddingTop: 12, maxHeight: '92%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { flex: 1, fontSize: 16, fontFamily: 'Montserrat-Bold', fontWeight: '700' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 12 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  noGrow: { flex: 0 },
  beta: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 8, backgroundColor: 'rgba(245,166,35,0.15)' },
  betaText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, minHeight: 28 },
  feedbackText: { flexShrink: 1, fontSize: 12, fontWeight: '700', alignSelf: 'center' },
  vote: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 },
  voteText: { fontSize: 12, fontWeight: '800' },
  cropTip: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginBottom: 8 },
  note: { fontSize: 12, lineHeight: 16, marginTop: 8 },
  center: { textAlign: 'center' },
  sourceRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  grow: { flex: 1 },
  outline: { borderWidth: 1.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  working: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 36 },
  sidesScroll: { maxHeight: 330 },
  sides: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  side: { flex: 1, borderRadius: 12, padding: 5 },
  sideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 4 },
  sideTitle: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  sideTotal: { fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  tile: { width: '32%', height: 64, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
  tileEmpty: { borderStyle: 'dashed' },
  tileImage: { width: 26, height: 26 },
  tileName: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  tileValue: { fontSize: 9, fontWeight: '700' },
  unsure: { position: 'absolute', top: 2, right: 2, width: 13, height: 13, borderRadius: 7, backgroundColor: FAIR, alignItems: 'center', justifyContent: 'center' },
  unsureText: { color: '#fff', fontSize: 9, fontWeight: '900', lineHeight: 11 },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 8, marginRight: 6 },
  swapText: { fontSize: 11, fontWeight: '700' },
  fixRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, marginTop: 8, paddingVertical: 6, paddingLeft: 8 },
  fixLabel: { fontSize: 11, fontWeight: '600', marginRight: 6, maxWidth: 90 },
  chips: { gap: 6, paddingRight: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 3, paddingHorizontal: 7, gap: 4 },
  chipImage: { width: 18, height: 18 },
  chipText: { fontSize: 11, fontWeight: '600' },
  result: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  resultValues: { color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  resultVerdict: { color: '#fff', fontSize: 17, fontWeight: '900', marginLeft: 8 },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  iconBtn: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
