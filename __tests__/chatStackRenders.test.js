/**
 * How many times do the chat screens redraw when realtime updates arrive?
 *
 * Every screen is replaced by a counter, the RTDB listeners by handlers we
 * drive by hand, and the real React Navigation native stack sits in between —
 * the redraws we care about come from how ChatStack hands its screens to that
 * navigator.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockRenders = {};
const mockCount = (name) => { mockRenders[name] = (mockRenders[name] || 0) + 1; };
const mockScreen = (name, { memo = false } = {}) => {
  const Screen = () => { mockCount(name); return null; };
  return { __esModule: true, default: memo ? require('react').memo(Screen) : Screen };
};

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../Code/ChatScreen/GroupChat/Trader', () => mockScreen('publicChat'));
jest.mock('../Code/ChatScreen/PrivateChat/PrivateChat', () => mockScreen('dm'));
jest.mock('../Code/ChatScreen/GroupChat/InboxScreen', () => mockScreen('inbox', { memo: true }));
const mockLastGroups = { value: null };
jest.mock('../Code/ChatScreen/GroupChat/GroupsScreen', () => ({
  __esModule: true,
  default: ({ groups }) => { mockCount('groups'); mockLastGroups.value = groups; return null; },
}));
jest.mock('../Code/ChatScreen/GroupChat/GroupChatScreen', () => mockScreen('groupChat'));
jest.mock('../Code/ChatScreen/PrivateChat/PrivateChatHeader', () => mockScreen('dmHeader', { memo: true }));
jest.mock('../Code/ChatScreen/PrivateChat/BlockUserList', () => mockScreen('blocked'));
jest.mock('../Code/ChatScreen/PrivateChat/ImageViewer', () => mockScreen('imageViewer'));
jest.mock('../Code/ChatScreen/GroupChat/CommunityChatHeader', () => mockScreen('chatHeader'));

const mockGlobal = { user: { id: 'me' }, appdatabase: {}, unreadMessagesCount: 0 };
jest.mock('../Code/GlobelStats', () => ({ useGlobalState: () => mockGlobal }));
const mockLocal = { localState: { bannedUsers: [] }, updateLocalState: () => {} };
jest.mock('../Code/LocalGlobelStats', () => ({ useLocalState: () => mockLocal }));
const mockHaptic = { triggerHapticFeedback: () => {} };
jest.mock('../Code/Helper/HepticFeedBack', () => ({ useHaptic: () => mockHaptic }));
const mockT = (k) => k;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));

// Hand-driven RTDB: chat_meta_data child events and the group_meta_data value.
const mockDb = { childChanged: new Set(), groupValue: new Set() };
jest.mock('@react-native-firebase/database', () => {
  const snap = (val, key) => ({ key, val: () => val, exists: () => val != null });
  return {
    ref: (db, path) => ({ path }),
    update: () => Promise.resolve(),
    get: () => Promise.resolve(snap(null)),
    onChildAdded: () => () => {},
    onChildChanged: (r, h) => {
      const fn = (key, val) => h(snap(val, key));
      mockDb.childChanged.add(fn);
      return () => mockDb.childChanged.delete(fn);
    },
    onChildRemoved: () => () => {},
    onValue: (r, h) => {
      const fn = (val) => h(snap(val));
      mockDb.groupValue.add(fn);
      fn(null);
      return () => mockDb.groupValue.delete(fn);
    },
  };
});

const { enableFreeze } = require('react-native-screens');
enableFreeze(true); // index.js does the same
const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
const { ChatStack } = require('../Code/ChatScreen/ChatNavigator');
const badgeStore = require('../Code/ChatScreen/chatBadgeStore');
const readBadges = () => {
  let value;
  const Probe = () => { value = badgeStore.useChatBadges(); return null; };
  let r;
  act(() => { r = ReactTestRenderer.create(<Probe />); });
  act(() => r.unmount());
  return value;
};

// native-stack only keeps the screen right under the focused one awake on
// Fabric (the new architecture this app runs on). It checks for this key at
// render time; set after the imports, which read it as an object.
global.nativeFabricUIManager = undefined;

const theme = { colors: { background: '#fff', text: '#000' } };
const reset = () => Object.keys(mockRenders).forEach((k) => { mockRenders[k] = 0; });

let unread = 0;
const dmMessage = (partnerId = 'friend') => {
  unread += 1;
  mockDb.childChanged.forEach((fn) => fn(partnerId, {
    chatId: 'friend_me', lastMessage: `hi ${unread}`, timestamp: unread, unreadCount: unread,
  }));
};
let groupSeq = 0;
const groupMessage = () => {
  groupSeq += 1;
  mockDb.groupValue.forEach((fn) => fn({
    'busy-group': {
      groupName: 'Busy', lastMessage: `m${groupSeq}`, lastMessageTimestamp: groupSeq, unreadCount: groupSeq,
    },
  }));
};

// One realtime event = its own JS task, so each one is flushed by itself.
// `gapMs` spaces the events out in (fake) time.
const each = async (n, fn, gapMs = 0) => {
  for (let i = 0; i < n; i += 1) {
    await act(async () => { fn(); jest.advanceTimersByTime(gapMs); });
  }
  // Let any throttled list flush land.
  await act(async () => { jest.advanceTimersByTime(2000); });
};

describe('chat stack redraws per realtime update', () => {
  let renderer;
  const nav = createNavigationContainerRef();

  beforeAll(async () => {
    jest.useFakeTimers();
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <NavigationContainer ref={nav}>
          <ChatStack selectedTheme={theme} setChatFocused={() => {}} modalVisibleChatinfo={false} setModalVisibleChatinfo={() => {}} />
        </NavigationContainer>,
      );
    });
    await act(async () => { jest.advanceTimersByTime(1000); });
  });

  afterAll(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  test('Inbox open: 50 DMs + 50 group messages', async () => {
    await act(async () => { nav.navigate('Inbox'); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, dmMessage);
    await each(50, groupMessage);
    console.log('[renders] Inbox open, 50 DMs + 50 group msgs:', JSON.stringify(mockRenders));
    // The public chat sits right under the Inbox and is not frozen on Fabric.
    expect(mockRenders.publicChat || 0).toBe(0);
    // At most the one throttled groups-list flush redraws the header.
    expect(mockRenders.chatHeader || 0).toBeLessThanOrEqual(1);
  });

  test('DM open: 50 messages from another chat + 50 group messages', async () => {
    await act(async () => {
      nav.navigate('PrivateChat', { selectedUser: { senderId: 'friend', sender: 'Friend' } });
    });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, () => dmMessage('someone-else'));
    await each(50, groupMessage);
    console.log('[renders] DM open, 50 other DMs + 50 group msgs:', JSON.stringify(mockRenders));
    expect(mockRenders.dm || 0).toBe(0);
    expect(mockRenders.inbox || 0).toBe(0);
  });

  test('badges follow the realtime counts', async () => {
    // Last values sent: 'friend' / 'someone-else' share the running counter,
    // so the two chats sit at 50 and 100; the group at its latest count.
    expect(readBadges()).toEqual({ dm: 150, group: groupSeq });
    act(() => badgeStore.acknowledgeDmBadge());
    await each(1, () => dmMessage('friend'));
    expect(readBadges().dm).toBe(51); // friend went 50 -> 101: 51 new since the tap
  });

  test('Groups open: 50 group messages over 2.5 s redraw the list a few times, not 50', async () => {
    await act(async () => { nav.navigate('Groups'); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, groupMessage, 50);
    console.log('[renders] Groups open, 50 group msgs in 2.5 s:', JSON.stringify(mockRenders));
    expect(mockRenders.groups).toBeLessThanOrEqual(8);
    expect(mockLastGroups.value[0].lastMessage).toBe(`m${groupSeq}`);
  });
});
