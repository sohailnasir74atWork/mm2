import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import Icon from 'react-native-vector-icons/FontAwesome';
import appleAuth, { AppleButton } from '@invertase/react-native-apple-authentication';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useGlobalState } from '../GlobelStats';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import { requestPermission } from '../Helper/PermissionCheck';
import { setPendingSigninChoice, clearPendingSigninChoice, emailOptInDefault } from '../Helper/emailOptIn';
import { handleOpenPrivacy, handleOpenTerms } from '../SettingScreen/settinghelper';
import config from '../Helper/Environment';
// import { showMessage } from 'react-native-flash-message';

import { getApp } from '@react-native-firebase/app';
import {
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  AppleAuthProvider,
  signOut,
  onAuthStateChanged,
} from '@react-native-firebase/auth';

const SignInDrawer = ({ visible, onClose, selectedTheme, message, screen }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);            // Google / reset
  const [isLoadingSecondary, setIsLoadingSecondary] = useState(false); // email/pass
  const [robloxUsernameError, setRobloxUsernameError] = useState('');
  const [robloxUsernamelocal, setRobloxUsernamelocal] = useState();
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false);
  // Email news-and-updates opt-in. Starts ticked outside the EU/EEA/UK/CH and
  // unticked inside them, where a pre-ticked box is not valid consent (see
  // emailOptInDefault). Applied by EmailOptInGate after sign-in, which also
  // runs the 13+ check. Read through a ref so the memoized sign-in handlers
  // always see the current value.
  const [emailUpdates, setEmailUpdates] = useState(emailOptInDefault);
  const emailUpdatesRef = useRef(emailUpdates);
  useEffect(() => { emailUpdatesRef.current = emailUpdates; }, [emailUpdates]);
  // Consent is per sign-in: a choice left from an earlier, abandoned attempt
  // must not carry over, so the box resets to its default whenever the drawer
  // closes.
  useEffect(() => { if (!visible) setEmailUpdates(emailOptInDefault()); }, [visible]);

  const { triggerHapticFeedback } = useHaptic();
  const { theme, robloxUsernameRef, user } = useGlobalState();
  const { t } = useTranslation();

  // 🔐 Modular Auth instance
  const app = getApp();
  const auth = getAuth(app);

  // Opened while Firebase already holds a session whose profile is still
  // loading (a slow login after the 3 s splash cap): this player IS signed in,
  // so show "loading your account" instead of the sign-in form, and close by
  // itself once the profile lands. Decided when the drawer opens only, so a
  // sign-in that starts inside the drawer is never affected.
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    setRestoring(visible && !!auth.currentUser && !user?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => {
    if (restoring && user?.id) {
      setRestoring(false);
      onClose?.();
    }
  }, [restoring, user?.id, onClose]);
  useEffect(() => {
    if (!restoring) return undefined;
    // The session went away instead (e.g. unverified email): show the form.
    return onAuthStateChanged(auth, (u) => { if (!u) setRestoring(false); });
  }, [restoring, auth]);

  const isDarkMode = theme === 'dark';

  useEffect(() => {
    robloxUsernameRef.current = robloxUsernamelocal;
  }, [robloxUsernamelocal, robloxUsernameRef]);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '312806709908-c579rlm0rhdem882lisnpvd21no3onc8.apps.googleusercontent.com',
      offlineAccess: true,
    });
  }, []);

  useEffect(() => {
    if (!appleAuth.isSupported) return;

    return appleAuth.onCredentialRevoked(async () => {
      try {
        await signOut(auth);
        showWarningMessage('Session Expired', 'Please sign in again.');
      } catch (e) {
        // Error during signOut on Apple revoke
      }
    });
  }, [auth]);

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert(t('home.alert.error'), 'Enter valid email address');
      return;
    }

    const isValidEmail = (em) => /\S+@\S+\.\S+/.test(em);
    if (!isValidEmail(email)) {
      Alert.alert(t('home.alert.error'), t('signin.error_input_message'));
      return;
    }

    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      showSuccessMessage(t('home.alert.success'), t('signin.password_reset_email_sent'));
      setIsForgotPasswordMode(false);
    } catch (error) {
      showErrorMessage(
        t('home.alert.error'),
        error?.message || t('signin.error_reset_password')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const onAppleButtonPress = useCallback(async () => {
    triggerHapticFeedback('impactLight');
    setPendingSigninChoice(emailUpdatesRef.current);

    try {
      const { identityToken, nonce } = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
      });

      if (!identityToken) throw new Error(t('signin.error_apple_token'));

      const appleCredential = AppleAuthProvider.credential(identityToken, nonce);
      await signInWithCredential(auth, appleCredential);

      showSuccessMessage(t('home.alert.success'), t('signin.success_signin'));
      setTimeout(onClose, 200);
      await requestPermission();
    } catch (error) {
      // Keep the choice if sign-in itself went through and only a later
      // step (the notification permission request) threw.
      if (!auth.currentUser) clearPendingSigninChoice();
      showErrorMessage(
        t('home.alert.error'),
        error?.message || t('signin.error_signin_message')
      );
    }
  }, [auth, t, triggerHapticFeedback, onClose, screen]);

  const handleSignInOrRegister = async () => {
    triggerHapticFeedback('impactLight');

    if (!email || !password) {
      Alert.alert(t('home.alert.error'), t('signin.error_input_message'));
      return;
    }

    const isValidEmail = (em) => /\S+@\S+\.\S+/.test(em);
    if (!isValidEmail(email)) {
      Alert.alert(t('home.alert.error'), t('signin.error_input_message'));
      return;
    }

    setIsLoadingSecondary(true);

    try {
      if (isRegisterMode) {
        // Registration signs straight back out; the choice applies at sign-in.
        clearPendingSigninChoice();
        // 🔐 Register new user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          await user.sendEmailVerification();
          await signOut(auth);

          Alert.alert(
            '✅ Account Created',
            "Please check your inbox to verify your email. If you don't see it, check the Spam or Promotions folder."
          );
          return;
        }
      } else {
        // 🔐 Login existing user
        setPendingSigninChoice(emailUpdatesRef.current);
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          clearPendingSigninChoice();
          await user.sendEmailVerification();
          await signOut(auth);

          Alert.alert(
            '📩 Email Not Verified',
            'A new verification link has been sent to your email. Please check your inbox or spam folder before signing in.'
          );
          return;
        }

        Alert.alert(t('signin.alert_welcome_back'), t('signin.success_signin'));
        await requestPermission();
        setTimeout(onClose, 200);
      }
    } catch (error) {
      // Keep the choice if sign-in itself went through and only a later
      // step (the notification permission request) threw.
      if (!auth.currentUser) clearPendingSigninChoice();
      // Error handling for login

      let errorMessage = t('signin.error_signin_message');

      if (error?.code === 'auth/invalid-email') errorMessage = t('signin.error_invalid_email_format');
      else if (error?.code === 'auth/user-disabled') errorMessage = t('signin.error_user_disabled');
      else if (error?.code === 'auth/user-not-found') errorMessage = t('signin.error_user_not_found');
      else if (error?.code === 'auth/wrong-password') errorMessage = t('signin.error_wrong_password');
      else if (error?.code === 'auth/email-already-in-use') errorMessage = t('signin.error_email_in_use');
      else if (error?.code === 'auth/weak-password') errorMessage = t('signin.error_weak_password');
      // The network case was unmapped, so a blocked/throttled connection looked
      // identical to a wrong password.
      else if (error?.code === 'auth/network-request-failed') {
        errorMessage = t('signin.error_network', {
          defaultValue: 'We couldn\'t reach the sign-in server. Check your connection and try again. If Google services are restricted on your network, try email sign-in or a different connection.',
        });
      }

      Alert.alert(t('signin.error_signin_message'), errorMessage);
    } finally {
      setIsLoadingSecondary(false);
    }
  };

  const handleGoogleSignIn = useCallback(async () => {
    triggerHapticFeedback('impactLight');
    setPendingSigninChoice(emailUpdatesRef.current);

    try {
      setIsLoading(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();
      const idToken = signInResult?.idToken || signInResult?.data?.idToken;
      if (!idToken) throw new Error(t('signin.error_signin_message'));

      const googleCredential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, googleCredential);

      showSuccessMessage(t('signin.alert_welcome_back'), t('signin.success_signin'));
      setTimeout(onClose, 200);
      await requestPermission();
    } catch (error) {
      // Keep the choice if sign-in itself went through and only a later
      // step (the notification permission request) threw.
      if (!auth.currentUser) clearPendingSigninChoice();
      // Every Google failure used to render the same "unexpected error", which
      // told users nothing. The two common real causes are (a) no/outdated
      // Google Play Services — widespread on devices in regions where Google
      // services are restricted — and (b) the request never reaching Google.
      // Both are recoverable by signing in with email instead, so say so.
      const code = error?.code;
      const msg = String(error?.message || '');

      if (code === '12501' || code === 12501 || /cancel/i.test(msg)) {
        return; // user backed out — not an error worth a toast
      }

      const noPlayServices =
        code === '2' || code === 2 || /play\s*services/i.test(msg);
      const networkish =
        /network|timeout|unreachable|failed to connect|ETIMEDOUT|ENOTFOUND/i.test(msg) ||
        code === 'auth/network-request-failed';

      if (noPlayServices) {
        showErrorMessage(
          t('signin.error_google_unavailable_title', { defaultValue: 'Google sign-in unavailable' }),
          t('signin.error_google_unavailable', {
            defaultValue: 'Google Play Services isn\'t available on this device. Please sign in with your email below instead.',
          })
        );
      } else if (networkish) {
        showErrorMessage(
          t('signin.error_network_title', { defaultValue: 'Connection problem' }),
          t('signin.error_network', {
            defaultValue: 'We couldn\'t reach the sign-in server. Check your connection and try again. If Google services are restricted on your network, try email sign-in or a different connection.',
          })
        );
      } else {
        showErrorMessage(
          t('signin.error_google_signin', { defaultValue: 'Google Sign-In Error' }),
          error?.message || t('signin.error_signin_message')
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [auth, t, triggerHapticFeedback, onClose, screen]);

  if (visible && restoring) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={styles.modalOverlay} onPress={onClose} />
        <View style={[styles.drawer, { backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight }]}>
          <View style={styles.restoringBox}>
            <ActivityIndicator size="large" color={selectedTheme.colors.text} />
            <Text style={[styles.text, styles.restoringText, { color: selectedTheme.colors.text }]}>{t('signin.restoring')}</Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <ConditionalKeyboardWrapper>
        <Pressable onPress={() => {}}>
          <View style={[styles.drawer, { backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight }]}>
            <Text style={[styles.title, { color: selectedTheme.colors.text }]}>
              {isRegisterMode
                ? t('signin.title_register')
                : isForgotPasswordMode
                ? 'Forget Password'
                : t('signin.title_signin')}
            </Text>

            <View>
              <Text style={[styles.text, { color: selectedTheme.colors.text }]}>{message}</Text>
            </View>

            {/* Email / Password fields */}
            {!isForgotPasswordMode && (
              <>
                <TextInput
                  style={[
                    styles.input, 
                    { 
                      color: selectedTheme.colors.text,
                      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
                      borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
                    }
                  ]}
                  placeholder={t('signin.placeholder_email')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={isDarkMode ? config.colors.placeholderDark : config.colors.placeholderLight}
                />

                <TextInput
                  style={[
                    styles.input, 
                    { 
                      color: selectedTheme.colors.text,
                      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
                      borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
                    }
                  ]}
                  placeholder={t('signin.placeholder_password')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholderTextColor={isDarkMode ? config.colors.placeholderDark : config.colors.placeholderLight}
                />
              </>
            )}

            {isForgotPasswordMode && (
              <TextInput
                style={[
                  styles.input, 
                  { 
                    color: selectedTheme.colors.text,
                    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
                    borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
                  }
                ]}
                placeholder={t('signin.placeholder_email')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={isDarkMode ? config.colors.placeholderDark : config.colors.placeholderLight}
              />
            )}

            <TouchableOpacity
              style={[styles.secondaryButton, { alignItems: 'flex-end', paddingBottom: 10 }]}
              onPress={() => setIsForgotPasswordMode(!isForgotPasswordMode)}
            >
              <Text style={[
                styles.secondaryButtonText,
                { color: isDarkMode ? config.colors.linkDark : config.colors.linkLight }
              ]}>
                {isForgotPasswordMode ? 'Signin Mode' : 'Forgetpassword Mode'}
              </Text>
            </TouchableOpacity>

            {!isForgotPasswordMode && (
              <TouchableOpacity
                style={styles.optInRow}
                onPress={() => setEmailUpdates((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: emailUpdates }}
              >
                <View style={[styles.checkbox, emailUpdates && styles.checkboxChecked]}>
                  {emailUpdates && <Icon name="check" size={12} color="white" />}
                </View>
                <Text style={[styles.optInText, { color: selectedTheme.colors.text }]}>
                  {t('signin.email_updates_optin', { defaultValue: 'Email me news and updates (optional)' })}
                </Text>
              </TouchableOpacity>
            )}

            {isForgotPasswordMode ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleForgotPassword}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send Reset Link</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSignInOrRegister}
                disabled={isLoadingSecondary}
              >
                {isLoadingSecondary ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isRegisterMode ? t('signin.title_register') : t('signin.title_signin')}
                  </Text>
                )}
              </TouchableOpacity>
            )}

<View style={styles.container}>
  <View style={[
    styles.line, 
    { backgroundColor: isDarkMode ? config.colors.dividerDark : config.colors.dividerLight }
  ]} />
  <Text style={[styles.textoR, { color: selectedTheme.colors.text }]}>
    {t('signin.or')}
  </Text>
  <View style={[
    styles.line, 
    { backgroundColor: isDarkMode ? config.colors.dividerDark : config.colors.dividerLight }
  ]} />
</View>

            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleSignIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Icon name="google" size={20} color="white" style={styles.googleIcon} />
                  <Text style={styles.googleButtonText}>{t('signin.google_signin')}</Text>
                </>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <AppleButton
                buttonStyle={
                  isDarkMode ? AppleButton.Style.WHITE : AppleButton.Style.BLACK
                }
                buttonType={AppleButton.Type.SIGN_IN}
                style={styles.applebUUTON}
                onPress={onAppleButtonPress}
              />
            )}

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                if (!isForgotPasswordMode) {
                  setIsRegisterMode(!isRegisterMode);
                }
              }}
            >
              <Text style={[
                styles.secondaryButtonText,
                { color: isDarkMode ? config.colors.linkDark : config.colors.linkLight }
              ]}>
                {isRegisterMode
                  ? t('signin.button_switch_signin')
                  : t('signin.button_switch_register')}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.legalText, { color: selectedTheme.colors.text }]}>
              {t('signin.legal_prefix', { defaultValue: 'By continuing, you agree to our ' })}
              <Text style={styles.legalLink} onPress={handleOpenTerms}>
                {t('signin.legal_terms', { defaultValue: 'Terms' })}
              </Text>
              {t('signin.legal_and', { defaultValue: ' and ' })}
              <Text style={styles.legalLink} onPress={handleOpenPrivacy}>
                {t('signin.legal_privacy', { defaultValue: 'Privacy Policy' })}
              </Text>
              .
            </Text>
          </View>
        </Pressable>
      </ConditionalKeyboardWrapper>
    </Modal>
  );
};

const styles = StyleSheet.create({
  optInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'grey',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#007BFF',
    borderColor: '#007BFF',
  },
  optInText: {
    flex: 1,
    fontSize: 13,
  },
  legalText: {
    fontSize: 11,
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 8,
    lineHeight: 16,
  },
  legalLink: {
    textDecorationLine: 'underline',
  },
  restoringBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  restoringText: {
    marginTop: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  drawer: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    paddingHorizontal: 20,
    paddingTop: 20,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Lato-Bold',
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 40,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginTop: 15,
  },
  primaryButton: {
    backgroundColor: '#007BFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontFamily: 'Lato-Bold',
  },
  secondaryButton: {
    padding: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    textDecorationLine: 'underline',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DB4437',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
    height: 40,
  },
  applebUUTON: {
    height: 40,
    width: '100%',
  },
  googleIcon: {
    marginRight: 10,
  },
  googleButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
  text: {
    alignSelf: 'center',
    fontSize: 12,
    paddingVertical: 3,
    marginBottom: 10,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  line: {
    flex: 1,
    height: 1,
  },
  textoR: {
    marginHorizontal: 10,
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
  errorText: {
    fontSize: 12,
    marginTop: 5,
    marginLeft: 5,
  },
});

export default SignInDrawer;
