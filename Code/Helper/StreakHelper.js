/**
 * StreakHelper.js
 * Private message streaks — track consecutive days of chatting between users.
 *
 * Firestore structure:  streaks/{uid1_uid2}
 *   ├── count: 5
 *   ├── lastActivity: Timestamp
 *   └── users: [uid1, uid2]
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  Timestamp,
  collection,
  query,
  where,
  getDocs,
} from '@react-native-firebase/firestore';

/**
 * Deterministic doc ID for a user pair.
 * Sorts UIDs so both users reference the same doc.
 */
export const getStreakDocId = (uid1, uid2) => {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

const isSameDay = (ts1, ts2) => {
  const d1 = ts1 instanceof Date ? ts1 : ts1.toDate();
  const d2 = ts2 instanceof Date ? ts2 : ts2.toDate();
  return (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate()
  );
};

const isYesterday = (ts1, ts2) => {
  const d1 = ts1 instanceof Date ? ts1 : ts1.toDate();
  const d2 = ts2 instanceof Date ? ts2 : ts2.toDate();
  const day1 = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate()));
  const day2 = new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate()));
  return day2.getTime() - day1.getTime() === 86400000;
};

/**
 * Update streak between two users. Call when a DM is sent.
 */
export const updateStreak = async (firestoreDB, myUid, otherUid) => {
  if (!firestoreDB || !myUid || !otherUid || myUid === otherUid) return;

  try {
    const docId = getStreakDocId(myUid, otherUid);
    const streakRef = doc(firestoreDB, 'streaks', docId);
    const streakSnap = await getDoc(streakRef);
    const now = new Date();

    if (!streakSnap.exists()) {
      await setDoc(streakRef, {
        count: 1,
        lastActivity: Timestamp.fromDate(now),
        users: [myUid, otherUid].sort(),
      });
      return;
    }

    const data = streakSnap.data();
    const lastActivity = data.lastActivity;

    if (!lastActivity) {
      await updateDoc(streakRef, { count: 1, lastActivity: Timestamp.fromDate(now) });
      return;
    }

    if (isSameDay(lastActivity, now)) return; // Already counted today

    if (isYesterday(lastActivity, now)) {
      await updateDoc(streakRef, {
        count: (data.count || 0) + 1,
        lastActivity: Timestamp.fromDate(now),
      });
    } else {
      await updateDoc(streakRef, { count: 1, lastActivity: Timestamp.fromDate(now) });
    }
  } catch (error) {
    console.warn('Streak update error:', error?.message || error);
  }
};

/**
 * Fetch all active streaks (≥ 2 days) for a user.
 * Returns Map<otherUserId, streakCount>
 */
export const getMyStreaks = async (firestoreDB, myUid) => {
  if (!firestoreDB || !myUid) return new Map();

  try {
    const streaksRef = collection(firestoreDB, 'streaks');
    const q = query(streaksRef, where('users', 'array-contains', myUid));
    const snapshot = await getDocs(q);

    const streakMap = new Map();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.count >= 2) {
        const otherUid = data.users.find(uid => uid !== myUid);
        if (otherUid) streakMap.set(otherUid, data.count);
      }
    });

    return streakMap;
  } catch (error) {
    console.warn('Get streaks error:', error?.message || error);
    return new Map();
  }
};
