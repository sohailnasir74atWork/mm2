/**
 * chatImages.js — how DM and group-chat photos are picked and shrunk before
 * upload (ported from Adopt Me's PrivateMessageInput / GroupMessageInput).
 *
 * Before this, chat photos went up at full size and anything over 1 MB was
 * refused, which is most camera photos. Now the picker already resizes to
 * 1920px, then safeCompressImage brings each photo to about 1024px, and the
 * 1 MB check applies to that compressed file. The upload itself still goes
 * through uploadImage() (Code/Helper/imageUpload.js): no storage key here.
 */
import RNFS from 'react-native-fs';
import { safeCompressImage } from './safeCompressImage';

export const CHAT_IMAGE_MAX_BYTES = 1024 * 1024; // 1 MB, after compression

// Spread into the pickImages() options (selectionLimit stays with the caller).
export const CHAT_IMAGE_PICKER_OPTIONS = {
  mediaType: 'photo',
  quality: 0.8,
  maxWidth: 1920,
  maxHeight: 1920,
};

const CHAT_IMAGE_COMPRESS_OPTIONS = {
  maxWidth: 1024,
  quality: 0.7,
  returnableOutputType: 'uri',
};

/**
 * Compress each picked asset, then size-check the file that will be uploaded.
 * Resolves to { uris, rejected }: `uris` are ready for uploadImage(),
 * `rejected` counts the photos still over 1 MB after compression. A file whose
 * size cannot be read is let through, as before (the server caps it at 3 MB).
 */
export async function prepareChatImages(assets) {
  const uris = [];
  let rejected = 0;
  const list = Array.isArray(assets) ? assets : [];

  for (const asset of list) {
    if (!asset?.uri || typeof asset.uri !== 'string') continue;

    // A GIF would come back as a still JPEG, so it keeps its own bytes and
    // only has to pass the size check.
    const isGif = asset.type === 'image/gif' || /\.gif$/i.test(asset.fileName || asset.uri);
    let uri = asset.uri;
    if (!isGif) {
      const out = await safeCompressImage(asset.uri, CHAT_IMAGE_COMPRESS_OPTIONS);
      uri = out.uri || asset.uri;
    }

    try {
      const fileInfo = await RNFS.stat(uri.replace('file://', ''));
      if ((Number(fileInfo?.size) || 0) > CHAT_IMAGE_MAX_BYTES) {
        rejected += 1;
        continue;
      }
    } catch (error) {
      console.warn('[chatImages] could not check file size:', error?.message);
    }
    uris.push(uri);
  }

  return { uris, rejected };
}
