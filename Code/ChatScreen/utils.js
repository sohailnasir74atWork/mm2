import { getDatabase, ref, update, get, set, onDisconnect, onValue, query, orderByChild, equalTo, limitToLast } from '@react-native-firebase/database';
import { getAuth } from '@react-native-firebase/auth';
import { Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { getServerTime } from '../Helper/serverTime';
import { invalidateFullProfile, setRoleOverride } from '../Helper/profileCache';
import { CHAT_CHANNEL_PATHS } from './chatChannels';
import { logModAction } from '../Helper/modLog';
import { getDeviceFingerprint, isValidDeviceKey } from '../Helper/deviceFingerprint';

// Initialize the database reference
const database = getDatabase();
const usersRef = ref(database, 'users'); // Base reference to the "users" node

// Format Date Utility
export const formatDate = (dateString) => {
  const date = new Date(dateString);
  return isNaN(date)
    ? 'Invalid Date' // Handle invalid date cases gracefully
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

// Ban User
export const banUser = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const deleteResult = await handleDeleteLast300Messages(userId, false);
    const database = getDatabase();
    const userToUpdateRef = ref(database, `users/${userId}`);
    await update(userToUpdateRef, { isBlock: true });
    
    const msgCount = deleteResult?.count || 0;
    Alert.alert('Success', `User banned.${msgCount > 0 ? ` ${msgCount} messages deleted.` : ''}`);
    return true;
  } catch (error) {
    console.error('Error banning user:', error);
    Alert.alert('Error', 'Failed to ban the user.');
    return false;
  }
};

// Unban User
export const unbanUser = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const database = getDatabase();
    const userToUpdateRef = ref(database, `users/${userId}`);
    await update(userToUpdateRef, { isBlock: false });
    Alert.alert('Success', 'User has been unbanned.');
    return true;
  } catch (error) {
    console.error('Error unbanning user:', error);
    Alert.alert('Error', 'Failed to unban the user.');
    return false;
  }
};

// Remove Admin
export const removeAdmin = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const db = getDatabase();
    const userToUpdateRef = ref(db, `users/${userId}`);
    await update(userToUpdateRef, { admin: false });
    Alert.alert('Success', 'Admin privileges removed.');
    return true;
  } catch (error) {
    console.error('Error removing admin:', error);
    Alert.alert('Error', 'Failed to remove admin privileges.');
    return false;
  }
};

// Make Admin
export const makeAdmin = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const db = getDatabase();
    const userToUpdateRef = ref(db, `users/${userId}`);
    await update(userToUpdateRef, { admin: true });
    Alert.alert('Success', 'User is now an admin.');
    return true;
  } catch (error) {
    console.error('Error making admin:', error);
    Alert.alert('Error', 'Failed to make user an admin.');
    return false;
  }
};

// Make Owner
export const makeOwner = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const db = getDatabase();
    const userToUpdateRef = ref(db, `users/${userId}`);
    await update(userToUpdateRef, { owner: true });
    Alert.alert('Success', 'User is now an owner.');
    return true;
  } catch (error) {
    console.error('Error making owner:', error);
    Alert.alert('Error', 'Failed to make user an owner.');
    return false;
  }
};
export const rulesen = [
  "Always communicate respectfully. Hate speech, discrimination, and harassment are strictly prohibited.",
  "Avoid sharing offensive, explicit, or inappropriate content, including text, images, or links.",
  "Do not share personal, sensitive, or confidential information such as phone numbers, addresses, or financial details.",
  "Spamming, repetitive messaging, or promoting products/services without permission is not allowed.",
  "If you encounter inappropriate behavior, use the report or block tools available in the app.",
  "Use appropriate language in the chat. Avoid abusive or overly aggressive tones.",
  "Discussions or activities promoting illegal or unethical behavior are prohibited.",
  "Users are responsible for the content they share and must adhere to community guidelines.",
  "Moderators reserve the right to monitor and take action on any violations, including warnings or bans.",
  "Content should be suitable for all approved age groups, adhering to app age requirements.",
  "Do not share links to harmful sites, malware, or malicious content.",
  "By using the chat feature, you agree to the app’s Terms of Service and Privacy Policy.https://mm2values.app/privacy",
];

export const rulesde  = [
    "Kommunizieren Sie immer respektvoll. Hassreden, Diskriminierung und Belästigung sind streng verboten.",
    "Vermeiden Sie das Teilen von anstößigen, expliziten oder unangemessenen Inhalten, einschließlich Text, Bildern oder Links.",
    "Geben Sie keine persönlichen, sensiblen oder vertraulichen Informationen wie Telefonnummern, Adressen oder Finanzdaten weiter.",
    "Spam, wiederholte Nachrichten oder das Bewerben von Produkten/Dienstleistungen ohne Erlaubnis sind nicht erlaubt.",
    "Wenn Sie unangemessenes Verhalten bemerken, nutzen Sie die Melde- oder Blockierfunktion der App.",
    "Verwenden Sie eine angemessene Sprache im Chat. Vermeiden Sie beleidigende oder aggressive Töne.",
    "Diskussionen oder Aktivitäten, die illegales oder unethisches Verhalten fördern, sind verboten.",
    "Benutzer sind für die Inhalte verantwortlich, die sie teilen, und müssen sich an die Community-Richtlinien halten.",
    "Moderatoren behalten sich das Recht vor, Verstöße zu überwachen und Maßnahmen zu ergreifen, einschließlich Verwarnungen oder Sperren.",
    "Inhalte sollten für alle genehmigten Altersgruppen geeignet sein und den Altersanforderungen der App entsprechen.",
    "Teilen Sie keine Links zu schädlichen Websites, Malware oder bösartigen Inhalten.",
    "Durch die Nutzung der Chat-Funktion stimmen Sie den Nutzungsbedingungen und der Datenschutzrichtlinie der App zu. https://mm2values.app/privacy"
  ]


  export const rulesvi  = [
    "Luôn giao tiếp một cách tôn trọng. Phát ngôn thù địch, phân biệt đối xử và quấy rối đều bị nghiêm cấm.",
    "Tránh chia sẻ nội dung phản cảm, rõ ràng hoặc không phù hợp, bao gồm văn bản, hình ảnh hoặc liên kết.",
    "Không chia sẻ thông tin cá nhân, nhạy cảm hoặc bảo mật như số điện thoại, địa chỉ hoặc dữ liệu tài chính.",
    "Không spam, gửi tin nhắn lặp lại hoặc quảng bá sản phẩm/dịch vụ mà không được phép.",
    "Nếu bạn gặp hành vi không phù hợp, hãy sử dụng công cụ báo cáo hoặc chặn có trong ứng dụng.",
    "Sử dụng ngôn ngữ phù hợp trong cuộc trò chuyện. Tránh giọng điệu lăng mạ hoặc hung hăng.",
    "Các cuộc thảo luận hoặc hoạt động thúc đẩy hành vi bất hợp pháp hoặc phi đạo đức bị cấm.",
    "Người dùng chịu trách nhiệm về nội dung họ chia sẻ và phải tuân thủ nguyên tắc cộng đồng.",
    "Người điều hành có quyền giám sát và thực hiện hành động đối với bất kỳ vi phạm nào, bao gồm cảnh báo hoặc cấm.",
    "Nội dung phải phù hợp với tất cả các nhóm tuổi được phê duyệt, tuân theo yêu cầu về độ tuổi của ứng dụng.",
    "Không chia sẻ liên kết đến các trang web độc hại, phần mềm độc hại hoặc nội dung độc hại.",
    "Bằng cách sử dụng tính năng trò chuyện, bạn đồng ý với Điều khoản dịch vụ và Chính sách quyền riêng tư của ứng dụng. https://mm2values.app/privacy"
  ]

  export const rulesid  = [
   "Selalu berkomunikasi dengan hormat. Ujaran kebencian, diskriminasi, dan pelecehan dilarang keras.",
    "Hindari berbagi konten yang menyinggung, eksplisit, atau tidak pantas, termasuk teks, gambar, atau tautan.",
    "Jangan bagikan informasi pribadi, sensitif, atau rahasia seperti nomor telepon, alamat, atau data keuangan.",
    "Spam, pengiriman pesan berulang, atau promosi produk/jasa tanpa izin tidak diperbolehkan.",
    "Jika Anda menemukan perilaku yang tidak pantas, gunakan alat laporan atau pemblokiran yang tersedia di aplikasi.",
    "Gunakan bahasa yang sesuai dalam obrolan. Hindari nada kasar atau agresif.",
    "Diskusi atau aktivitas yang mendorong perilaku ilegal atau tidak etis dilarang.",
    "Pengguna bertanggung jawab atas konten yang mereka bagikan dan harus mematuhi pedoman komunitas.",
    "Moderator berhak untuk memantau dan mengambil tindakan terhadap pelanggaran, termasuk peringatan atau larangan.",
    "Konten harus sesuai untuk semua kelompok umur yang disetujui, sesuai dengan persyaratan usia aplikasi.",
    "Jangan bagikan tautan ke situs berbahaya, malware, atau konten berbahaya.",
    "Dengan menggunakan fitur obrolan, Anda menyetujui Ketentuan Layanan dan Kebijakan Privasi aplikasi. https://mm2values.app/privacy"
  ]

  export const rulesfr  = [
    "Communiquez toujours avec respect. Les discours de haine, la discrimination et le harcèlement sont strictement interdits.",
    "Évitez de partager du contenu offensant, explicite ou inapproprié, y compris du texte, des images ou des liens.",
    "Ne partagez pas d’informations personnelles, sensibles ou confidentielles telles que des numéros de téléphone, des adresses ou des données financières.",
    "Le spam, l’envoi répété de messages ou la promotion de produits/services sans autorisation ne sont pas autorisés.",
    "Si vous observez un comportement inapproprié, utilisez les outils de signalement ou de blocage disponibles dans l’application.",
    "Utilisez un langage approprié dans le chat. Évitez les tons insultants ou agressifs.",
    "Les discussions ou activités encourageant des comportements illégaux ou contraires à l’éthique sont interdites.",
    "Les utilisateurs sont responsables du contenu qu’ils partagent et doivent respecter les règles de la communauté.",
    "Les modérateurs se réservent le droit de surveiller et de prendre des mesures contre toute violation, y compris des avertissements ou des interdictions.",
    "Le contenu doit être adapté à tous les groupes d’âge approuvés, conformément aux exigences d’âge de l’application.",
    "Ne partagez pas de liens vers des sites nuisibles, des logiciels malveillants ou du contenu malveillant.",
    "En utilisant la fonction de chat, vous acceptez les Conditions d’utilisation et la Politique de confidentialité de l’application. https://mm2values.app/privacy"
   ]

   export const rulesfil  = [
    "Laging makipag-usap nang may paggalang. Ang mapoot na pananalita, diskriminasyon, at pananakot ay mahigpit na ipinagbabawal.",
    "Iwasan ang pagbabahagi ng nakakasakit, malaswa, o hindi angkop na nilalaman, kabilang ang teksto, larawan, o mga link.",
    "Huwag ibahagi ang personal, sensitibo, o kumpidensyal na impormasyon tulad ng mga numero ng telepono, address, o data sa pananalapi.",
    "Ang spam, paulit-ulit na pagpapadala ng mensahe, o promosyon ng produkto/serbisyo nang walang pahintulot ay hindi pinapayagan.",
    "Kung makakita ka ng hindi naaangkop na pag-uugali, gamitin ang tool sa pag-uulat o pag-block sa app.",
    "Gumamit ng angkop na wika sa chat. Iwasan ang bastos o agresibong tono.",
    "Ipinagbabawal ang mga talakayan o aktibidad na nagtataguyod ng ilegal o hindi etikal na pag-uugali.",
    "Ang mga gumagamit ay may pananagutan sa nilalaman na kanilang ibinabahagi at dapat sumunod sa mga patakaran ng komunidad.",
    "Ang mga moderator ay may karapatang subaybayan at gumawa ng aksyon laban sa anumang paglabag, kabilang ang mga babala o pagbabawal.",
    "Ang nilalaman ay dapat na angkop para sa lahat ng pinapayagang pangkat ng edad, alinsunod sa mga kinakailangan sa edad ng app.",
    "Huwag magbahagi ng mga link sa nakakapinsalang mga site, malware, o mapanirang nilalaman.",
    "Sa paggamit ng tampok na chat, sumasang-ayon ka sa Mga Tuntunin ng Serbisyo at Patakaran sa Privacy ng app. https://mm2values.app/privacy"
   ]

   export const rulesru  = [
    "Всегда общайтесь уважительно. Речи ненависти, дискриминация и преследование строго запрещены.",
    "Избегайте распространения оскорбительного, непристойного или неуместного контента, включая текст, изображения или ссылки.",
    "Не делитесь личной, конфиденциальной или чувствительной информацией, такой как номера телефонов, адреса или финансовые данные.",
    "Спам, повторяющиеся сообщения или реклама товаров/услуг без разрешения запрещены.",
    "Если вы заметили неподобающее поведение, используйте инструменты жалоб или блокировки в приложении.",
    "Используйте соответствующий язык в чате. Избегайте оскорбительного или агрессивного тона.",
    "Запрещены обсуждения или действия, продвигающие незаконное или неэтичное поведение.",
    "Пользователи несут ответственность за публикуемый контент и должны соблюдать правила сообщества.",
    "Модераторы имеют право контролировать и применять меры против нарушений, включая предупреждения или блокировки.",
    "Контент должен быть подходящим для всех одобренных возрастных групп, соответствуя требованиям приложения по возрасту.",
    "Не делитесь ссылками на вредоносные сайты, вредоносное ПО или вредоносный контент.",
    "Используя чат, вы соглашаетесь с Условиями использования и Политикой конфиденциальности приложения. https://mm2values.app/privacy"
   ]
   export const rulespt = [
    "Comunique-se sempre com respeito. Discursos de ódio, discriminação e assédio são estritamente proibidos.",
    "Evite compartilhar conteúdo ofensivo, explícito ou inapropriado, incluindo texto, imagens ou links.",
    "Não compartilhe informações pessoais, sensíveis ou confidenciais, como números de telefone, endereços ou dados financeiros.",
    "Spam, envio repetitivo de mensagens ou promoção de produtos/serviços sem permissão não são permitidos.",
    "Se encontrar um comportamento inadequado, utilize as ferramentas de denúncia ou bloqueio disponíveis no aplicativo.",
    "Use uma linguagem apropriada no chat. Evite tons ofensivos ou agressivos.",
    "Discussões ou atividades que promovam comportamentos ilegais ou antiéticos são proibidas.",
    "Os usuários são responsáveis pelo conteúdo que compartilham e devem seguir as diretrizes da comunidade.",
    "Os moderadores têm o direito de monitorar e tomar medidas contra qualquer violação, incluindo advertências ou banimentos.",
    "O conteúdo deve ser adequado para todas as faixas etárias aprovadas, de acordo com os requisitos de idade do aplicativo.",
    "Não compartilhe links para sites prejudiciais, malware ou conteúdos maliciosos.",
    "Ao usar o recurso de chat, você concorda com os Termos de Serviço e a Política de Privacidade do aplicativo. https://mm2values.app/privacy"
   ]

// export const banUserInChat = async (currentUserId, selectedUser) => {
//   return new Promise((resolve, reject) => {
//     Alert.alert(
//       'Block User',
//       `Are you sure you want to block ${selectedUser.sender || 'this user'}? You will no longer receive messages from them.`,
//       [
//         { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
//         {
//           text: 'Block',
//           style: 'destructive',
//           onPress: async () => {
//             try {
//               const database = getDatabase();
//               const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUser.senderId}`);

//               // Save the banned user's details in the database
//               await set(bannedRef, {
//                 displayName: selectedUser.sender || 'Anonymous',
//                 avatar: selectedUser.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
//               });

//               Alert.alert(
//                 'Success',
//                 `You have successfully blocked ${selectedUser.sender || 'this user'}.`
//               );
//               resolve(true); // Indicate success
//             } catch (error) {
//               console.error('Error blocking user:', error);
//               Alert.alert('Error', 'Could not block the user. Please try again.');
//               reject(error); // Indicate failure with the error
//             }
//           },
//         },
//       ]
//     );
//   });
// };

// export const unbanUserInChat = async (currentUserId, selectedUserId) => {
//   return new Promise((resolve, reject) => {
//     Alert.alert(
//       'Unblock User',
//       'Are you sure you want to unblock this user? You will start receiving messages from them again.',
//       [
//         { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
//         {
//           text: 'Unblock',
//           style: 'destructive',
//           onPress: async () => {
//             try {
//               const database = getDatabase();
//               const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUserId}`);

//               // Remove the banned user's data from the database
//               await remove(bannedRef);

//               Alert.alert('Success', 'You have successfully unblocked this user.');
//               resolve(true); // Indicate success
//             } catch (error) {
//               console.error('Error unblocking user:', error);
//               Alert.alert('Error', 'Could not unblock the user. Please try again.');
//               reject(error); // Indicate failure with the error
//             }
//           },
//         },
//       ]
//     );
//   });
// };







export const isUserOnline = async (userId) => {
  if (!userId) return false; // ✅ Return early if userId is invalid

  try {
    // ✅ Read from presence node instead of users/{uid}/online
    const presenceRef = ref(getDatabase(), `presence/${userId}`);
    const snapshot = await get(presenceRef);
    
    return snapshot.val() ?? false; // ✅ Return online status OR false (cleaner)
  } catch (error) {
    console.error("🔥 Error checking user online status:", error);
    return false; // ✅ Always return a boolean
  }
};

export const setActiveChat = async (userId, chatId) => {
  // ✅ Safety checks
  if (!userId || !chatId) {
    console.error('❌ Invalid userId or chatId for setActiveChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeChatRef = ref(database, `/activeChats/${userId}`);
    const unreadRef = ref(database, `/private_messages/${chatId}/unread/${userId}`);

    await set(activeChatRef, chatId);
    await set(unreadRef, 0);
    await onDisconnect(activeChatRef).remove();
  } catch (error) {
    console.error(`❌ Failed to set active chat for user ${userId}:`, error);
  }
};





export const clearActiveChat = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    console.error('❌ Invalid userId for clearActiveChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeChatRef = ref(database, `/activeChats/${userId}`);

    await set(activeChatRef, null);
  } catch (error) {
    console.error(`❌ Failed to clear active chat for user ${userId}:`, error);
  }
};

// ========== Group Chat Helper Functions ==========

/**
 * Set active group chat (for efficient batch checking)
 * @param {String} userId - User ID
 * @param {String} groupId - Group ID
 */
export const setActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.error('❌ Invalid userId or groupId for setActiveGroupChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, true);
    await onDisconnect(activeGroupRef).remove(); // Auto-clear on disconnect
  } catch (error) {
    console.error('❌ Failed to set active group chat:', error);
  }
};

/**
 * Clear active group chat
 * @param {String} userId - User ID
 * @param {String} groupId - Group ID
 */
export const clearActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.error('❌ Invalid userId or groupId for clearActiveGroupChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, null);
  } catch (error) {
    console.error('❌ Failed to clear active group chat:', error);
  }
};

/**
 * Check if user is in active group (for notifications)
 * @param {String} groupId - Group ID
 * @param {String} userId - User ID
 * @returns {Promise<boolean>}
 */
export const isUserInActiveGroup = async (groupId, userId) => {
  if (!groupId || !userId) return false;

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    const snapshot = await get(activeGroupRef);
    return snapshot.exists() && snapshot.val() === true;
  } catch (error) {
    console.error('❌ Error checking active group:', error);
    return false;
  }
};

export const handleDeleteLast300Messages = async (senderId, showAlert = false) => {
  // ✅ Safety check
  if (!senderId) {
    console.error('❌ Invalid senderId for handleDeleteLast300Messages');
    return { success: false, count: 0 };
  }

  try {
    const db = getDatabase();
    // Sweep every language room, not just English. A spammer moderators are
    // cleaning up after can have posted in any of them, and this used to look
    // like it had worked while leaving the other channels untouched.
    // Each channel declares `.indexOn: senderId`, so these stay indexed reads.
    const snapshots = await Promise.all(
      CHAT_CHANNEL_PATHS.map((path) => get(query(
        ref(db, path),
        orderByChild('senderId'),
        equalTo(senderId),
        limitToLast(80),
      )).then((snap) => ({ path, snap })).catch(() => ({ path, snap: null }))),
    );

    // Flatten every room into one list, each entry keeping the node it came
    // from so the delete targets the right channel.
    const collected = [];
    for (const { path, snap } of snapshots) {
      if (!snap || !snap.exists()) continue;
      const messages = snap.val();
      if (!messages || typeof messages !== 'object') continue;
      for (const [key, value] of Object.entries(messages)) {
        if (key) collected.push({ path, key, timestamp: value?.timestamp || 0 });
      }
    }

    if (collected.length === 0) {
      if (showAlert) {
        Alert.alert('Info', 'No messages found to delete.');
      }
      return { success: true, count: 0 };
    }

    // Newest 60 ACROSS all rooms, so the cap still means what it says.
    const sorted = collected
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 60);

    const updates = {};
    sorted.forEach(({ path, key }) => {
      if (key) {
        updates[`${path}/${key}`] = null;
      }
    });

    const deletedCount = Object.keys(updates).length;
    if (deletedCount > 0) {
      await update(ref(db), updates);
      if (showAlert) {
        Alert.alert('Success', `${deletedCount} messages deleted.`);
      }
    }
    
    return { success: true, count: deletedCount };
  } catch (error) {
    console.error('🔥 Failed to delete messages:', error);
    if (showAlert) {
      Alert.alert('Error', 'Failed to delete messages.');
    }
    return { success: false, count: 0 };
  }
};


// ═══════════════════════════════════════════════════════════════════════
//  MODERATION — strikes, mutes, bans, roles
//  Ported from adoptme-jan7 2026-09-05 (PLAN_2026-09.md P3/P4), rewritten
//  for RTDB-only. Adopt Me reads roles through a Supabase mirror; MM2 has
//  no Supabase, so everything below is the RTDB record directly.
//
//  Storage: banned_users_by_email/{encodedEmail}
//    { strikeCount, bannedUntil, reason, bannedAt, userId, displayName,
//      avatar, email, bannedBy, bannerAvatar }
//  `bannedUntil` is either a ms timestamp or the string 'permanent'.
//  A mute is the same record with a short bannedUntil and NO strike bump.
// ═══════════════════════════════════════════════════════════════════════

// Keys are encoded exactly as every existing reader encodes them
// (Trader.jsx, UploadModal.js, GlobelStats.js). Do not add a .toLowerCase()
// here without migrating those readers and the existing rows together —
// a mismatch silently un-bans everyone.
export const encodeEmailForBan = (email) => String(email).replace(/\./g, '(dot)');

// Strike ladder. Kept at MM2's existing 3h / 3d / permanent rather than
// Adopt Me's 12h / 24h — changing it would silently re-sentence users the
// moderators already warned under the current rules.
const STRIKE_LADDER = {
  1: { ms: 3 * 60 * 60 * 1000, label: '3 hours' },
  2: { ms: 3 * 24 * 60 * 60 * 1000, label: '3 days' },
};
const strikeSentence = (strikeCount) =>
  STRIKE_LADDER[strikeCount]
    ? { bannedUntil: Date.now() + STRIKE_LADDER[strikeCount].ms, banDuration: STRIKE_LADDER[strikeCount].label }
    : { bannedUntil: 'permanent', banDuration: 'permanent' };

// Shared record builder so ban / strike / mute rows are the same shape and
// the Admin Dashboard can render any of them without special-casing.
const buildBanRecord = ({ strikeCount, bannedUntil, reason, userInfo, bannerInfo, email }) => ({
  strikeCount,
  bannedUntil,
  reason,
  bannedAt: Date.now(),
  userId: userInfo?.id || null,
  displayName: userInfo?.displayName || userInfo?.sender || 'Unknown User',
  avatar: userInfo?.avatar || null,
  email,
  bannedBy: bannerInfo?.id || bannerInfo?.displayName || 'Admin',
  bannerAvatar: bannerInfo?.avatar || null,
});

// Audit-log fields shared by every writer below. `bannerInfo.role` is
// optional — the dashboard sets it; older call sites do not, and the log
// simply records no role for them.
const actorFields = (bannerInfo) => ({
  actorUid: bannerInfo?.id || null,
  actorName: bannerInfo?.displayName || null,
  actorRole: bannerInfo?.role || null,
});

// ── Device bans (ported from adoptme-jan7 2026-10-13) ──────────────────
//
// A ban or strike is mirrored onto banned_devices/{fingerprint} so the same
// phone cannot sign up again with a fresh account and carry on. Mutes are
// NOT mirrored (Adopt Me does not either): a mute is a timeout for one
// account, not a sanction on whoever holds the phone.
//
//   banned_devices/{fp}
//     { bannedUntil, bannedAt, bannedBy, reason, strikeCount, email, userId }
//
// The fingerprint comes from users_private/{uid}/deviceId, stamped at login
// by builds from 2026-10-13 on (Helper/deviceFingerprint.js). An account
// that has never signed in on such a build has none, and its ban stays
// email-only, exactly as before. The ban record itself carries `deviceIds`
// (plus `deviceId`, the first one, as Adopt Me writes it) so an unban knows
// which device rows to clear. Both are extra fields: old builds ignore them.
//
// Writes need the banned_devices rule (staff only; a moderator cannot touch
// a staff member's device). Until it is deployed the device write is refused
// and only the email ban applies, which is today's behaviour.

// A ban never waits longer than this on the device lookup.
const DEVICE_LOOKUP_MS = 4000;

const getUserDeviceId = async (db, userId) => {
  if (!userId) return null;
  try {
    const snap = await get(ref(db, `users_private/${userId}/deviceId`));
    const v = snap.exists() ? snap.val() : null;
    return isValidDeviceKey(v) ? v : null;
  } catch (_) {
    return null;
  }
};

// The device(s) a ban of `userId` should lock: the one stamped on the
// account, plus THIS device when the caller is banning their own account
// (Adopt Me's self-ban fallback, for a stamp that has not landed yet).
const resolveBanDeviceIds = async (db, userId) => {
  let timer = null;
  const work = (async () => {
    const stamped = await getUserDeviceId(db, userId);
    let current = null;
    const callerUid = getAuth()?.currentUser?.uid;
    if (userId && callerUid && userId === callerUid) {
      try { current = await getDeviceFingerprint(); } catch (_) { /* none */ }
    }
    return Array.from(new Set([stamped, current].filter(Boolean)));
  })();
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve([]), DEVICE_LOOKUP_MS); });
  try {
    return await Promise.race([work, timeout]);
  } catch (_) {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const deviceBanPayload = (record) => ({
  bannedUntil: record.bannedUntil,
  bannedAt: record.bannedAt || Date.now(),
  bannedBy: record.bannedBy || 'Admin',
  reason: record.reason || null,
  strikeCount: record.strikeCount || 1,
  email: record.email || null,
  userId: record.userId || null,
});

// Never throws. Resolves to the ids that were actually written.
const writeDeviceBans = async (db, deviceIds, record) => {
  const payload = deviceBanPayload(record);
  const results = await Promise.all(deviceIds.map((id) =>
    set(ref(db, `banned_devices/${id}`), payload).then(() => id, (e) => {
      console.warn('[deviceBan] write refused for', id, e?.message);
      return null;
    })));
  return results.filter(Boolean);
};

// Ids an email-ban record says it mirrored to: `deviceIds` (array) and the
// scalar `deviceId`, honouring both like Adopt Me's unban does.
const deviceIdsOfRecord = (v) => {
  const out = [];
  if (Array.isArray(v?.deviceIds)) v.deviceIds.forEach((id) => { if (isValidDeviceKey(id)) out.push(id); });
  if (isValidDeviceKey(v?.deviceId)) out.push(v.deviceId);
  return out;
};

const sameEmail = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.replace(/\(dot\)/g, '.').trim().toLowerCase() === b.replace(/\(dot\)/g, '.').trim().toLowerCase();

/**
 * Staff tools: the device recorded for `uid` and its live device-ban row.
 * { deviceId: string|null, ban: object|null }. Never throws.
 */
export const getDeviceBanForUser = async (uid) => {
  const db = getDatabase();
  const deviceId = await getUserDeviceId(db, uid);
  if (!deviceId) return { deviceId: null, ban: null };
  try {
    const snap = await get(ref(db, `banned_devices/${deviceId}`));
    return { deviceId, ban: snap.exists() ? snap.val() : null };
  } catch (_) {
    return { deviceId, ban: null };
  }
};

/**
 * Lift ONLY the device ban, leaving any account ban in place. For a shared
 * or family phone where a different account was the one banned.
 */
export const liftDeviceBan = async (deviceId, bannerInfo = null, target = null, reason = null, source = 'admin_dashboard') => {
  if (!isValidDeviceKey(deviceId)) return false;
  try {
    const db = getDatabase();
    const snap = await get(ref(db, `banned_devices/${deviceId}`));
    const prior = snap.exists() ? snap.val() : null;
    await set(ref(db, `banned_devices/${deviceId}`), null);
    logModAction({
      action: 'unban',
      targetEmail: target?.email || prior?.email || null,
      targetUid: target?.id || prior?.userId || null,
      targetName: target?.displayName || null,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'Device ban lifted',
      strikeCount: prior?.strikeCount ?? null,
      source,
      meta: { deviceOnly: true, bannedEmail: prior?.email || null },
      ...actorFields(bannerInfo),
    });
    return true;
  } catch (e) {
    console.warn('[deviceBan] lift failed:', e?.message);
    return false;
  }
};

/**
 * Extend an account's LIVE ban to the device it is signed in on now. For an
 * account banned before it ever ran a build that records its device: once
 * it signs in on a new build, staff can lock the phone too. Refuses when
 * there is no live ban or no recorded device.
 */
export const applyBanToDevice = async (email, uid, bannerInfo = null) => {
  if (!email || !uid) return { ok: false, why: 'missing' };
  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);
    const snap = await get(banRef);
    const record = snap.exists() ? snap.val() : null;
    const until = record?.bannedUntil;
    const live = until === 'permanent' || (typeof until === 'number' && until > Date.now());
    if (!record || !live || !((record.strikeCount || 0) >= 1)) return { ok: false, why: 'no_ban' };
    const deviceId = await getUserDeviceId(db, uid);
    if (!deviceId) return { ok: false, why: 'no_device' };
    const written = await writeDeviceBans(db, [deviceId], { ...record, email: record.email || email, userId: record.userId || uid });
    if (written.length === 0) return { ok: false, why: 'refused' };
    const ids = Array.from(new Set([...deviceIdsOfRecord(record), deviceId]));
    await update(banRef, { deviceId: ids[0], deviceIds: ids }).catch(() => {});
    logModAction({
      action: 'ban', targetEmail: email, targetUid: uid, targetName: record.displayName || null,
      reason: record.reason || null, strikeCount: record.strikeCount || null, bannedUntil: until,
      source: 'admin_dashboard', meta: { deviceOnly: true }, ...actorFields(bannerInfo),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, why: 'error' };
  }
};

/**
 * Central gate for moderator ban/mute/strike powers.
 * Admins are NEVER affected. Moderators and Junior Mods lose ban/mute/strike
 * when an admin sets RTDB /mod_controls_enabled to false. Default is ON:
 * only an explicit `false` disables it, so a denied or offline read leaves
 * staff working exactly as before.
 * Delete-message powers are deliberately NOT gated by this switch.
 */
export const canStaffBanMute = ({ isAdmin, isModerator, isBabyMod, modControlsEnabled } = {}) =>
  !!isAdmin || ((!!isModerator || !!isBabyMod) && modControlsEnabled !== false);

/**
 * Ban a user by email, escalating their strike count.
 * Additive signature — the original (email, isAdmin, senderId) call sites
 * keep working unchanged.
 */
export const banUserwithEmail = async (
  email,
  isAdmin = false,
  senderId = null,
  userInfo = null,
  bannerInfo = null,
  customReason = null,
  source = 'unknown',
) => {
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for banUserwithEmail');
    if (isAdmin) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);
    const snap = await get(banRef);

    let strikeCount = 1;
    if (snap.exists()) {
      const data = snap.val();
      if (data && typeof data === 'object') {
        // Admins escalate; a moderator re-applying a ban does not stack it.
        strikeCount = isAdmin ? (data.strikeCount || 0) + 1 : (data.strikeCount || 1);
      }
    }

    const { bannedUntil, banDuration } = strikeSentence(strikeCount);
    const reason = typeof customReason === 'string' && customReason.trim() ? customReason.trim() : `Strike ${strikeCount}`;
    const record = buildBanRecord({
      strikeCount,
      bannedUntil,
      reason,
      userInfo: { ...(userInfo || {}), id: senderId || userInfo?.id || null },
      bannerInfo,
      email,
    });

    // Device mirror: tag the record first (one write, no race with a fast
    // unban), then lock the device row(s) without holding up the ban.
    const deviceIds = await resolveBanDeviceIds(db, record.userId);
    if (deviceIds.length > 0) {
      record.deviceId = deviceIds[0];
      record.deviceIds = deviceIds;
    }

    await set(banRef, record);

    if (deviceIds.length > 0) writeDeviceBans(db, deviceIds, record);

    // History, not awaited: a log failure must never fail a real ban.
    logModAction({
      action: 'ban', targetEmail: email, targetUid: record.userId, targetName: record.displayName,
      reason, strikeCount, bannedUntil, source, ...actorFields(bannerInfo),
    });

    if (isAdmin) {
      Alert.alert('User Banned', `Strike ${strikeCount} applied (${banDuration}).`);
    }
    return true;
  } catch (err) {
    console.error('Ban error:', err);
    if (isAdmin) Alert.alert('Error', 'Could not ban user.');
    return false;
  }
};

/**
 * Set an EXACT strike level, rather than escalating from whatever is there.
 * This is what the Admin Dashboard's Strike 1 / 2 / 3 buttons call.
 */
export const setUserStrike = async (
  email,
  strikeCount,
  senderId = null,
  showAlert = true,
  bannerInfo = null,
  userInfo = null,
  customReason = null,
  source = 'unknown',
) => {
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }
  if (!strikeCount || strikeCount < 1) {
    if (showAlert) Alert.alert('Error', 'Invalid strike count.');
    return false;
  }

  try {
    const db = getDatabase();
    const { bannedUntil, banDuration } = strikeSentence(strikeCount);
    const reason = typeof customReason === 'string' && customReason.trim() ? customReason.trim() : `Strike ${strikeCount}`;
    const record = buildBanRecord({
      strikeCount,
      bannedUntil,
      reason,
      userInfo: { ...(userInfo || {}), id: senderId || userInfo?.id || null },
      bannerInfo,
      email,
    });

    // Device mirror, as in banUserwithEmail.
    const deviceIds = await resolveBanDeviceIds(db, record.userId);
    if (deviceIds.length > 0) {
      record.deviceId = deviceIds[0];
      record.deviceIds = deviceIds;
    }

    await set(ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`), record);

    if (deviceIds.length > 0) writeDeviceBans(db, deviceIds, record);

    logModAction({
      action: 'strike', targetEmail: email, targetUid: record.userId, targetName: record.displayName,
      reason, strikeCount, bannedUntil, source, ...actorFields(bannerInfo),
    });

    if (showAlert) Alert.alert('Strike Applied', `Strike ${strikeCount} applied (${banDuration}).`);
    return true;
  } catch (err) {
    console.error('Set strike error:', err);
    if (showAlert) Alert.alert('Error', 'Could not apply strike.');
    return false;
  }
};

/**
 * Mute for N minutes. Same record shape as a ban with a short bannedUntil,
 * so every existing ban check enforces it for free — but the strike count is
 * PRESERVED, not incremented. A mute is a timeout, not a strike.
 */
export const muteUser = async (
  email,
  minutes,
  userInfo = null,
  bannerInfo = null,
  showAlert = true,
  customReason = null,
  source = 'unknown',
) => {
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }
  if (!minutes || minutes < 1) {
    if (showAlert) Alert.alert('Error', 'Mute duration must be at least 1 minute.');
    return false;
  }

  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);
    const snap = await get(banRef);
    const existing = snap.exists() ? (snap.val() || {}) : {};
    const existingStrikeCount = existing.strikeCount || 0;
    const bannedUntil = Date.now() + minutes * 60 * 1000;

    // Mute and ban share one record and this is a set(), so a 5-minute
    // mute on someone serving a permanent ban used to silently REPLACE the
    // ban with a 5-minute timeout. Refuse to shorten a longer live sanction
    // and say why — lifting a ban is unban's job, not mute's.
    const until = existing.bannedUntil;
    const longerLive = until === 'permanent' || (typeof until === 'number' && until > bannedUntil);
    if (longerLive) {
      if (showAlert) {
        Alert.alert(
          'Already restricted',
          until === 'permanent'
            ? 'This user is permanently banned. A mute would have replaced that ban with a short timeout, so nothing was changed.'
            : 'This user already has a longer restriction in force. Unban first if you mean to shorten it.',
        );
      }
      return false;
    }

    const reason = typeof customReason === 'string' && customReason.trim() ? customReason.trim() : `Muted for ${minutes} min`;
    const record = buildBanRecord({
      strikeCount: existingStrikeCount,
      bannedUntil,
      reason,
      userInfo,
      bannerInfo,
      email,
    });
    // A mute is not mirrored to the device, but this set() replaces the
    // record, so carry the device tags of an earlier ban forward: without
    // them a later unban could not find the device rows to clear.
    const priorDeviceIds = deviceIdsOfRecord(existing);
    if (priorDeviceIds.length > 0) {
      const ids = Array.from(new Set(priorDeviceIds));
      record.deviceId = ids[0];
      record.deviceIds = ids;
    }

    await set(banRef, record);

    logModAction({
      action: 'mute', targetEmail: email, targetUid: record.userId, targetName: record.displayName,
      reason, durationMinutes: minutes, bannedUntil, source, ...actorFields(bannerInfo),
    });

    if (showAlert) Alert.alert('User Muted', `Muted for ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
    return true;
  } catch (err) {
    console.error('Mute error:', err);
    if (showAlert) Alert.alert('Error', 'Could not mute user.');
    return false;
  }
};

/**
 * Lift a ban or mute. Clears both key casings, since older rows may differ.
 * Additive signature: (email, showAlert) callers keep working; the dashboard
 * passes who lifted it and why so the history can say so.
 */
export const unbanUserWithEmail = async (email, showAlert = true, bannerInfo = null, reason = null, source = 'unknown') => {
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for unbanUserWithEmail');
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  try {
    const db = getDatabase();
    const key = encodeEmailForBan(email);
    const keyLower = encodeEmailForBan(email.toLowerCase());

    // Read before delete so the log can name the person and what was lifted,
    // and so the device rows this ban mirrored to can be cleared with it.
    let prior = null;
    const mirroredIds = new Set();
    try {
      const snap = await get(ref(db, `banned_users_by_email/${key}`));
      prior = snap.exists() ? snap.val() : null;
      deviceIdsOfRecord(prior).forEach((id) => mirroredIds.add(id));
      if (keyLower !== key) {
        const s2 = await get(ref(db, `banned_users_by_email/${keyLower}`));
        const v2 = s2.exists() ? s2.val() : null;
        if (!prior) prior = v2;
        deviceIdsOfRecord(v2).forEach((id) => mirroredIds.add(id));
      }
    } catch (e) { /* the delete still proceeds */ }

    await set(ref(db, `banned_users_by_email/${key}`), null);
    if (keyLower !== key) {
      await set(ref(db, `banned_users_by_email/${keyLower}`), null);
    }

    // Device rows. Besides the tagged ids, check the device the account is
    // on now: a record rewritten by a writer that drops the tags (the server
    // report auto-ban, an old build) would otherwise strand its device ban.
    // That one is cleared only when its row names THIS account, so lifting
    // one account never releases a device another account got banned on.
    try {
      const current = await getUserDeviceId(db, prior?.userId);
      if (current && !mirroredIds.has(current)) {
        const ds = await get(ref(db, `banned_devices/${current}`));
        const row = ds.exists() ? ds.val() : null;
        if (row && (sameEmail(row.email, email) || (prior?.userId && row.userId === prior.userId))) {
          mirroredIds.add(current);
        }
      }
    } catch (e) { /* best effort */ }
    if (mirroredIds.size > 0) {
      await Promise.all(Array.from(mirroredIds).map((id) =>
        set(ref(db, `banned_devices/${id}`), null).catch(() => {})));
    }

    logModAction({
      action: 'unban', targetEmail: email, targetUid: prior?.userId || null, targetName: prior?.displayName || null,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      strikeCount: prior?.strikeCount ?? null,
      source, ...actorFields(bannerInfo),
    });

    if (showAlert) Alert.alert('User Unbanned', 'Ban has been lifted.');
    return true;
  } catch (err) {
    console.error('Unban error:', err);
    if (showAlert) Alert.alert('Error', 'Could not unban user.');
    return false;
  }
};

/**
 * Is this email currently banned or muted?
 *
 * Compares against SERVER time, not Date.now(). A device clock rolled
 * forward is the standard way users escape a timed ban, and it works
 * against any check that trusts the local clock.
 */
export const checkBanStatus = async (email) => {
  if (!email || typeof email !== 'string') return { isBanned: false, message: null };

  const db = getDatabase();
  try {
    const snap = await get(ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`));
    if (!snap.exists()) return { isBanned: false, message: null };

    const { bannedUntil, strikeCount } = snap.val() || {};

    if (bannedUntil === 'permanent') {
      return { isBanned: true, message: `You are permanently banned (Strike ${strikeCount}).` };
    }
    if (typeof bannedUntil !== 'number') return { isBanned: false, message: null };

    const probeUid = getAuth()?.currentUser?.uid || encodeEmailForBan(email);
    const now = (await getServerTime(db, probeUid)).getTime();
    if (bannedUntil <= now) return { isBanned: false, message: null };

    const diff = bannedUntil - now;
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const parts = [];
    if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

    return {
      isBanned: true,
      message: `You are banned for ${parts.join(' ') || 'less than a minute'} (Strike ${strikeCount}).`,
    };
  } catch (error) {
    console.error('Error checking ban status:', error);
    // Fail open: a database hiccup must not lock out the whole user base.
    return { isBanned: false, message: null };
  }
};

// ── Role grants ────────────────────────────────────────────────────────
//
// One writer for every role flag, so the cache invalidation and the
// optimistic override can never be forgotten at a call site. The roster
// Cloud Functions trigger on these individual leaves.
//
// ⚠️ These are UI-level grants only until the RTDB rules in
// database.rules.json are deployed — `users/$uid` is currently
// world-writable, so a client can set its own `admin` flag over REST.
const writeRoleFlag = async (userId, flag, value, { successMsg, errorMsg } = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  try {
    const db = getDatabase();
    await update(ref(db, `users/${userId}`), {
      [flag]: value ? true : null, // null deletes the key rather than storing false
      rolesUpdatedAt: Date.now(),
    });
    invalidateFullProfile(userId);
    setRoleOverride(userId, { [flag]: !!value });
    if (successMsg) Alert.alert('Success', successMsg);
    return true;
  } catch (error) {
    console.error(`Error writing role ${flag}:`, error);
    Alert.alert('Error', errorMsg || 'Failed to update role.');
    return false;
  }
};

export const makeModerator = (userId) =>
  writeRoleFlag(userId, 'isModerator', true, { successMsg: 'User is now a moderator.', errorMsg: 'Failed to promote user.' });

export const removeModerator = (userId) =>
  writeRoleFlag(userId, 'isModerator', false, { successMsg: 'Moderator privileges removed.', errorMsg: 'Failed to demote user.' });

export const makeBabyMod = (userId) =>
  writeRoleFlag(userId, 'isBabyMod', true, { successMsg: 'User is now a Junior Mod.', errorMsg: 'Failed to set Junior Mod.' });

export const removeBabyMod = (userId) =>
  writeRoleFlag(userId, 'isBabyMod', false, { successMsg: 'Junior Mod removed.', errorMsg: 'Failed to remove Junior Mod.' });

export const makeTrusted = (userId) =>
  writeRoleFlag(userId, 'isTrusted', true, { successMsg: 'Trusted badge granted.', errorMsg: 'Failed to set Trusted badge.' });

export const removeTrusted = (userId) =>
  writeRoleFlag(userId, 'isTrusted', false, { successMsg: 'Trusted badge removed.', errorMsg: 'Failed to remove Trusted badge.' });

export const makeCMSR = (userId) =>
  writeRoleFlag(userId, 'isCMSR', true, { successMsg: 'CMSR badge granted.', errorMsg: 'Failed to set CMSR badge.' });

export const removeCMSR = (userId) =>
  writeRoleFlag(userId, 'isCMSR', false, { successMsg: 'CMSR badge removed.', errorMsg: 'Failed to remove CMSR badge.' });

export const makeHelper = (userId) =>
  writeRoleFlag(userId, 'isHelper', true, { successMsg: 'Helper badge granted.', errorMsg: 'Failed to set Helper badge.' });

export const removeHelper = (userId) =>
  writeRoleFlag(userId, 'isHelper', false, { successMsg: 'Helper badge removed.', errorMsg: 'Failed to remove Helper badge.' });

// ========== Real-time Online Status ==========

/**
 * Real-time online status hook — uses onValue listener on presence/{userId}.
 * Unlike isUserOnline() which is a one-shot get(), this updates live
 * when the user goes online/offline.
 */
export const useOnlineStatus = (userId) => {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsOnline(false);
      return;
    }

    const presenceRef = ref(getDatabase(), `presence/${userId}`);
    const unsubscribe = onValue(presenceRef, (snapshot) => {
      setIsOnline(snapshot.val() === true);
    }, (error) => {
      console.error('useOnlineStatus listener error:', error);
      setIsOnline(false);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [userId]);

  return isOnline;
};

// ========== Read Receipts (lastRead) ==========

/**
 * Update lastRead timestamp for the current user in a private chat.
 * Called when user enters or is actively viewing the chat.
 */
export const updateLastRead = async (chatKey, userId) => {
  if (!chatKey || !userId) return;

  try {
    const db = getDatabase();
    const lastReadRef = ref(db, `private_messages/${chatKey}/lastRead/${userId}`);
    await set(lastReadRef, Date.now());
  } catch (error) {
    console.warn('updateLastRead error:', error?.message);
  }
};

/**
 * Hook: listen to the OTHER user's lastRead timestamp.
 * Returns a timestamp (number) or 0 if not yet read.
 */
export const useOtherLastRead = (chatKey, otherUserId) => {
  const [lastRead, setLastRead] = useState(0);

  useEffect(() => {
    if (!chatKey || !otherUserId) {
      setLastRead(0);
      return;
    }

    const db = getDatabase();
    const lastReadRef = ref(db, `private_messages/${chatKey}/lastRead/${otherUserId}`);

    const unsubscribe = onValue(lastReadRef, (snapshot) => {
      setLastRead(snapshot.exists() ? (Number(snapshot.val()) || 0) : 0);
    }, (error) => {
      console.warn('useOtherLastRead listener error:', error?.message);
      setLastRead(0);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [chatKey, otherUserId]);

  return lastRead;
};

