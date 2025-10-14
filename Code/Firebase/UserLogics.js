import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export const logoutUser = async (setUser) => {
  try {
    // Firebase sign out
    await auth().signOut();

    // Google sign out (check if already signed in)
    if (GoogleSignin?.isSignedIn) {
      const isGoogleSignedIn = await GoogleSignin.isSignedIn();
      if (isGoogleSignedIn) {
        await GoogleSignin.revokeAccess();
        await GoogleSignin.signOut();
      }
    }
    
    // (Optional) Handle Apple sign out logic if needed
    // Apple doesn't maintain persistent sessions like Google,
    // but if your app saves anything from it, clear here

    // Reset your local state
    setUser({
      id: null,
      selectedFruits: [],
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      points: 0,
      isBlock: false,
      fcmToken: null,
      lastactivity: null,
      online: false,
    });

    console.log('✅ Logout successful');
  } catch (error) {
    console.error('🔥 Error logging out:', error.message);
  }
};

// Delete the current user
export const deleteUser = async () => {
    try {
        const user = auth().currentUser;
        if (user) {
            await user.delete();
            // console.log('User deleted');
        } else {
            // console.log('No user is currently logged in.');
        }
    } catch (error) {
        console.error('Error deleting user:', error.message);
        throw error;
    }
};

