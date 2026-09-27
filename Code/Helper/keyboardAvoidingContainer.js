import React, { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Keyboard, Platform, Animated, Easing } from 'react-native';

const ConditionalKeyboardWrapper = ({ children, style, chatscreen = false, privatechatscreen = false, noTabBar = false }) => {
  const keyboardHeight = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Use 'will' events on iOS for smoother animations (fires before animation starts)
    // Use 'did' events on Android (standard for Android)
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (e) => {
      const height = e.endCoordinates?.height || 0;
      Animated.timing(keyboardHeight, {
        toValue: height,
        duration: Platform.OS === 'ios' ? (e?.duration || 200) : 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(keyboardHeight, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? (e?.duration || 200) : 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardHeight]);

  // ✅ For chat and private chat screens: use KeyboardAvoidingView with padding behavior
  // This ensures the input sits right on top of the keyboard without extra space
  if (chatscreen || privatechatscreen) {
    if (Platform.OS === 'ios') {
      const iosOffset = noTabBar ? 95 : 120;
      return (
        <KeyboardAvoidingView
          behavior="padding"
          style={style}
          keyboardVerticalOffset={iosOffset}
        >
          {children}
        </KeyboardAvoidingView>
      );
    }

    return (
      <KeyboardAvoidingView
        behavior="padding"
        style={style}
        enabled={true}
        keyboardVerticalOffset={noTabBar ? 90 : 115}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  // ✅ For all other screens, use default KeyboardAvoidingView behavior (no custom offset)
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView
        behavior="padding"
        style={style}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={style}
      enabled={true}
    >
      {children}
    </KeyboardAvoidingView>
  );
};

/**
 * Keyboard avoidance for content INSIDE a <Modal>.
 *
 * A KeyboardAvoidingView placed outside a Modal does nothing for what is
 * inside it: RN renders a Modal into its own window on Android and its own
 * view controller on iOS, so the two layouts are completely independent.
 * Every modal that contains a TextInput has to handle the keyboard itself.
 *
 * The two platforms need opposite things:
 *
 *   Android — nothing. ReactModalHostView sets SOFT_INPUT_ADJUST_RESIZE on the
 *     dialog window (react-native/ReactAndroid/.../ReactModalHostView.kt), so
 *     the modal's own layout already shrinks to the space above the keyboard.
 *     behavior={undefined} leaves KeyboardAvoidingView an inert View; adding
 *     'padding' on top of the OS resize would move the content twice.
 *
 *   iOS — 'padding'. There is no automatic resize; without this the keyboard
 *     just covers the bottom of the modal, which on a centred report dialog
 *     means the reason box and the Submit button both disappear.
 *
 * `style` should carry the flex:1 overlay style the modal was already using,
 * so this slots in as a drop-in replacement for that outer View.
 */
export const ModalKeyboardView = ({ children, style, offset = 0 }) => (
  <KeyboardAvoidingView
    style={style}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={offset}
  >
    {children}
  </KeyboardAvoidingView>
);

export default ConditionalKeyboardWrapper;
