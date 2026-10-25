/**
 * The Inbox list: how often does it redraw, and does it rebuild when the
 * player comes back from a DM?
 *
 * RTDB is replaced by a hand-driven ref (child_added / child_changed /
 * value), FlatList by a counter that records each `data` it is given.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockLists = [];
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const FlatList = ({ data }) => { mockLists.push(data); return null; };
  return { __esModule: true, default: FlatList };
});
jest.mock('react-native-vector-icons/Ionicons', () => () => null);
jest.mock('react-native-popup-menu', () => ({
  Menu: () => null, MenuOptions: () => null, MenuOption: () => null, MenuTrigger: () => null,
}));
jest.mock('../Code/ChatScreen/GroupChat/FramedAvatar', () => () => null);
jest.mock('../Code/Helper/MessageHelper', () => ({ showSuccessMessage: () => {}, showErrorMessage: () => {} }));
jest.mock('../Code/Helper/profileCache', () => ({ getCachedProfile: () => ({}), warmProfileCache: () => Promise.resolve() }));
jest.mock('../Code/Helper/Environment', () => ({ colors: { primary: '#000' } }));
const mockGlobal = { user: { id: 'me' }, theme: 'light', appdatabase: {} };
jest.mock('../Code/GlobelStats', () => ({ useGlobalState: () => mockGlobal }));
const mockT = (k) => k;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));

// Focus is driven by hand: `mockFocus.blur()` / `mockFocus.focus()`.
const mockFocus = { effects: new Set(), cleanups: new Map() };
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => ({ navigate: () => {} }),
    useFocusEffect: (cb) => {
      R.useEffect(() => {
        const run = () => { mockFocus.cleanups.set(cb, cb()); };
        mockFocus.effects.add(run);
        run();
        return () => {
          mockFocus.effects.delete(run);
          const c = mockFocus.cleanups.get(cb);
          if (typeof c === 'function') c();
        };
      }, [cb]);
    },
  };
});

// One RTDB location holding the chats; attaching child_added replays them.
// On the phone each replayed child is its own native event (its own JS task),
// then `value` fires; the replay is queued here and drained one event per act.
const mockChats = new Map();
const mockHandlers = { child_added: new Set(), child_changed: new Set(), child_removed: new Set() };
const mockQueue = [];
const snap = (key, val) => ({ key, val: () => val });
jest.mock('@react-native-firebase/database', () => {
  const ref = () => ({
    on: (ev, h) => {
      mockHandlers[ev].add(h);
      if (ev === 'child_added') mockChats.forEach((v, k) => mockQueue.push(() => h(snap(k, v))));
      return h;
    },
    off: (ev, h) => { mockHandlers[ev].delete(h); },
    once: () => new Promise((resolve) => {
      mockQueue.push(() => resolve(snap(null, Object.fromEntries(mockChats))));
    }),
  });
  return { __esModule: true, default: () => ({ ref }), ref };
});

const InboxScreen = require('../Code/ChatScreen/GroupChat/InboxScreen').default;

const N = 30;
for (let i = 0; i < N; i += 1) {
  mockChats.set(`p${i}`, { chatId: `c${i}`, lastMessage: `m${i}`, timestamp: i, unreadCount: 0 });
}
const emit = (ev, key, val) => mockHandlers[ev].forEach((h) => h(snap(key, val)));
const flush = async (ms = 1000) => {
  while (mockQueue.length) {
    const next = mockQueue.shift();
    await act(async () => { next(); });
  }
  await act(async () => { jest.advanceTimersByTime(ms); });
};
const listSizes = () => mockLists.map((d) => (d ? d.length : 0));

describe('Inbox list', () => {
  let r;
  beforeAll(async () => {
    jest.useFakeTimers();
    await act(async () => {
      r = ReactTestRenderer.create(<InboxScreen chats={[]} setChats={() => {}} loading={false} bannedUsers={[]} />);
    });
    await flush();
  });
  afterAll(() => { act(() => r.unmount()); jest.useRealTimers(); });

  test('first load paints the whole page at once', () => {
    const sizes = listSizes().filter((n) => n > 0);
    console.log('[inbox] first load list sizes:', JSON.stringify(sizes));
    // Never a partly filled list (1, 2, 3 … rows) on the way to 15.
    expect(sizes.every((n) => n === 15)).toBe(true);
  });

  test('coming back from a DM does not rebuild the list', async () => {
    mockLists.length = 0;
    await act(async () => { mockFocus.cleanups.forEach((c) => typeof c === 'function' && c()); });
    await act(async () => { mockFocus.effects.forEach((run) => run()); });
    await flush();
    const sizes = listSizes();
    console.log('[inbox] blur + focus list sizes:', JSON.stringify(sizes));
    expect(sizes.every((n) => n === 15)).toBe(true);
  });

  test('50 incoming messages in a stream redraw the list a few times, not 50', async () => {
    mockLists.length = 0;
    for (let i = 0; i < 50; i += 1) {
      await act(async () => {
        emit('child_changed', 'p3', { chatId: 'c3', lastMessage: `new ${i}`, timestamp: 1000 + i, unreadCount: i + 1 });
        jest.advanceTimersByTime(20);
      });
    }
    await flush();
    console.log('[inbox] 50 messages over 1 s, list redraws:', mockLists.length);
    expect(mockLists.length).toBeLessThanOrEqual(6);
    const top = mockLists[mockLists.length - 1][0];
    expect(top.otherUserId).toBe('p3');
    expect(top.lastMessage).toBe('new 49');
  });
});
