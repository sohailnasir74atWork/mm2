import Sound from 'react-native-sound';

Sound.setCategory('Playback', true);

const KEY_PREFIX = 'game_sound_';
const enabledCache = {};
let wooshSound = null;
let popSound = null;
let refCount = 0;
let loadPromise = null;
// Bumped by releaseGameSounds(). A load that was already in flight compares its
// own generation against this and, if it no longer matches, throws its buffer
// away instead of publishing it — see the comment in initGameSounds().
let generation = 0;

function getStorage() {
    try {
        return require('react-native-mmkv').MMKV ? require('../LocalGlobelStats').storage : null;
    } catch {
        return null;
    }
}

function keyFor(gameKey) {
    return `${KEY_PREFIX}${gameKey}`;
}

export async function initGameSounds() {
    refCount += 1;
    if (loadPromise) return loadPromise;
    if (wooshSound && popSound) return Promise.resolve();

    // Each Sound is held in a LOCAL and only published to the module variable
    // once it has actually loaded.
    //
    // The old code assigned `wooshSound = new Sound(...)` and then read that
    // same module variable back inside the load callback. But Sound's callback
    // arrives over the bridge from RNSound.prepare(), never synchronously — so
    // when the user opened a game and left again before the mp3 finished
    // decoding, releaseGameSounds() had already set `wooshSound = null`, and
    // the callback ran `null.setVolume(1.0)`. That is an uncaught
    // "TypeError: Cannot read property 'setVolume' of null", which React Native
    // turns into a fatal JavascriptException — and all eight game screens
    // mount/unmount this service, so backing out of a game quickly was enough.
    const myGeneration = generation;
    const stale = () => myGeneration !== generation;
    const settle = (resolve) => {
        // Only clear the shared handle if this load is still the current one;
        // a newer init (or releaseGameSounds) already owns it otherwise.
        if (!stale()) loadPromise = null;
        resolve();
    };

    loadPromise = new Promise((resolve) => {
        const woosh = new Sound('woosh.mp3', Sound.MAIN_BUNDLE, (err) => {
            if (err) {
                console.warn('[GameSound] Failed to load woosh:', err);
            } else if (stale()) {
                // Nobody is on a game screen any more (or a newer load has
                // superseded this one): hand the buffer straight back rather
                // than publishing a sound nothing will ever release.
                try { woosh.release(); } catch {}
            } else {
                woosh.setVolume(1.0);
                wooshSound = woosh;
            }

            if (stale()) {
                settle(resolve);
                return;
            }

            const pop = new Sound('pop.mp3', Sound.MAIN_BUNDLE, (err2) => {
                if (err2) {
                    console.warn('[GameSound] Failed to load pop:', err2);
                } else if (stale()) {
                    try { pop.release(); } catch {}
                } else {
                    pop.setVolume(1.0);
                    popSound = pop;
                }
                settle(resolve);
            });
        });
    });
    return loadPromise;
}

export function isSoundEnabled(gameKey) {
    if (gameKey in enabledCache) return enabledCache[gameKey];
    try {
        const s = getStorage();
        const val = s ? s.getBoolean(keyFor(gameKey)) !== false : true;
        enabledCache[gameKey] = val;
        return val;
    } catch {
        return true;
    }
}

export function setSoundEnabled(gameKey, val) {
    enabledCache[gameKey] = !!val;
    try {
        const s = getStorage();
        if (s) s.set(keyFor(gameKey), !!val);
    } catch {}
}

export function playWoosh(gameKey) {
    if (!isSoundEnabled(gameKey)) return;
    // Snapshot the handle: stop()'s callback is async too, so reading the module
    // variable again inside it could hit null after releaseGameSounds() ran.
    const sound = wooshSound;
    if (!sound) { console.warn('[GameSound] woosh not loaded'); return; }
    try {
        sound.stop(() => { sound.play((ok) => { if (!ok) console.warn('[GameSound] woosh play failed'); }); });
    } catch (e) { console.warn('[GameSound] woosh error:', e); }
}

export function playPop(gameKey) {
    if (!isSoundEnabled(gameKey)) return;
    const sound = popSound;
    if (!sound) { console.warn('[GameSound] pop not loaded'); return; }
    try {
        sound.stop(() => { sound.play((ok) => { if (!ok) console.warn('[GameSound] pop play failed'); }); });
    } catch (e) { console.warn('[GameSound] pop error:', e); }
}

export function startAmbient() {}
export function stopAmbient() {}

export function releaseGameSounds() {
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0) return;
    // Invalidate any load still in flight so its callback drops its buffer
    // instead of writing into the module variables we are about to clear.
    generation += 1;
    try {
        wooshSound?.release();
        popSound?.release();
        wooshSound = null;
        popSound = null;
        loadPromise = null;
    } catch {}
}
