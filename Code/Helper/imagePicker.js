/**
 * imagePicker.js — single-flight wrapper around react-native-image-picker.
 *
 * Why this exists: launchImageLibrary() is NOT safe to call while an earlier
 * call is still open. Each call starts its own activity under the same request
 * code (13003), so two overlapping picks produce two onActivityResult
 * deliveries — and the library holds the pending JS callback in one
 * unsynchronised field that it only clears from a background thread AFTER
 * reading the chosen image's metadata (real file I/O, hundreds of ms). Both
 * deliveries therefore read the same non-null callback and invoke it.
 *
 * A second invoke of the same callback is not a catchable error in React
 * Native: createJavaCallback() aborts the whole process with
 * "callback arg cannot be called more than once". That is the SIGABRT in
 * libreactnative.so with com.imagepicker frames on the stack — and a double-tap
 * on any attach / upload / change-avatar button was enough to trigger it.
 *
 * So every picker call in the app goes through pickImages(), which keeps at most
 * one pick in flight. A call that arrives while another pick is still open
 * reports itself as a cancel — every call site already treats didCancel as
 * "do nothing", so no call site needs a new branch.
 *
 * Supports both shapes the library offers, so call sites can keep whichever
 * they already use:
 *   const result = await pickImages(options);
 *   pickImages(options, (result) => { ... });
 */
import { launchImageLibrary } from 'react-native-image-picker';

// Shaped like a real picker response so callers need no extra branch.
const busyResponse = () => ({ didCancel: true, assets: [] });

const errorResponse = (error) => ({
  didCancel: false,
  errorCode: 'others',
  errorMessage: error?.message || 'Could not open the image picker.',
  assets: [],
});

let inFlight = null;

export const pickImages = async (options = {}, callback) => {
  const deliver = (response) => {
    if (typeof callback === 'function') {
      try {
        const maybePromise = callback(response);
        // The callback bodies are async (they upload), so surface a rejection
        // instead of letting it become an unhandled promise rejection.
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch((error) => {
            console.warn('[imagePicker] handler failed:', error?.message || error);
          });
        }
      } catch (error) {
        console.warn('[imagePicker] handler threw:', error?.message || error);
      }
    }
    return response;
  };

  // A pick is already open: a double-tap, or a second button pressed while the
  // picker is still up. Launching another one is what crashes, so report a
  // cancel instead.
  if (inFlight) {
    return deliver(busyResponse());
  }

  try {
    inFlight = launchImageLibrary(options);
    return deliver((await inFlight) || busyResponse());
  } catch (error) {
    // The library resolves with an errorCode rather than rejecting, but guard
    // anyway: if anything threw here the flag must still be cleared below, or
    // the picker would stay dead for the rest of the session.
    return deliver(errorResponse(error));
  } finally {
    inFlight = null;
  }
};

export default pickImages;
