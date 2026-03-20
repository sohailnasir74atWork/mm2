import { Platform } from "react-native";

const isNoman = true; // Toggle this to switch configurations

// noman app id = ca-app-pub-5740215782746766~6229019896
//waqas app id = ca-app-pub-3701208411582706~4267174419
// noman pkgName= com.mm2tradesvalues
//waqas pkgName = com.bloxfruitstock
const rev_cat_id = Platform.OS === 'ios' ? 'appl_pjMIQFzBcdWtHdGHYbxVLuWcMvA' : 'goog_DwvubjYPPPfqdtdrSvjSbrmAXFU'

const config = {
  appName: isNoman ? 'Blox Fruit Values Calc' : 'Blox Fruit Stock',
  andriodBanner: isNoman ? 'ca-app-pub-5740215782746766/2557142858' : 'ca-app-pub-3701208411582706/4133745803',
  andriodIntestial: isNoman ? 'ca-app-pub-5740215782746766/7725100246' : 'ca-app-pub-3701208411582706/2820664136',
  andriodRewarded: isNoman ? 'ca-app-pub-5740215782746766/5267066676' : 'ca-app-pub-3701208411582706/5175818984',
  andriodOpenApp: isNoman ? 'ca-app-pub-5740215782746766/6799047293' : 'ca-app-pub-3701208411582706/2295931822',
  andriodNative: isNoman ? 'ca-app-pub-5740215782746766/2941106105' : 'ca-app-pub-3701208411582706/5457520430',
  IOsIntestial: isNoman ? 'ca-app-pub-5740215782746766/4282766419' : '',
  IOsBanner: isNoman ? 'ca-app-pub-5740215782746766/1975349035' : '',
  IOsRewarded: isNoman ? 'ca-app-pub-5740215782746766/8470806324' : '',
  IOsOpenApp: isNoman ? 'ca-app-pub-5740215782746766/9662267365' : '',
  IOsNative: isNoman ? '' : '',
  gameInterstitialAndroid: 'ca-app-pub-5740215782746766/7231966561',

  gameInterstitialIOS: 'ca-app-pub-5740215782746766/5126152752',
  apiKey: isNoman ? rev_cat_id : 'goog_DwvubjYPPPfqdtdrSvjSbrmAXFU',

  supportEmail: isNoman ? 'thesolanalabs@gmail.com' : 'mindfusionio.help@gmail.com',
  andriodShareLink: isNoman ? 'https://play.google.com/store/apps/details?id=com.mm2tradesvalues' : 'https://play.google.com/store/apps/details?id=com.bloxfruitstock',

  isNoman: isNoman ? true : false,
  
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6737775801' : '',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6737775801' : '',
  webSite: isNoman ? 'https://mm2values.app/' : 'https://bloxfruitvalue.today',

  otherapplink: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.adoptmevaluescalc' : 'https://apps.apple.com/us/app/adoptme-values/id6745400111',
  otherapplink2: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.bloxfruitevalues' : 'https://apps.apple.com/us/app/fruits-values-calculator/id6737775801',
  colors: isNoman
    ? {
      // Primary brand colors
      primary: '#6A5ACD', // Slate blue - main brand color
      secondary: '#8B7FD9', // Lighter slate blue for secondary actions
      accent: '#3E8BFC', // Bright blue for highlights
      
      // Trade block colors
      hasBlockGreen: '#6A5ACD', // Use primary for consistency
      wantBlockRed: '#6A5ACD', // Use primary for consistency
      
      // Background colors
      backgroundLight: '#F8F9FA', // Soft off-white for light mode
      backgroundDark: '#121212', // True black for dark mode
      surfaceLight: '#FFFFFF', // Pure white for cards in light mode
      surfaceDark: '#1E1E1E', // Dark gray for cards in dark mode
      surfaceElevatedLight: '#FFFFFF', // Elevated surfaces light
      surfaceElevatedDark: '#2A2A2A', // Elevated surfaces dark
      
      // Text colors
      textLight: '#000000', // Black text for light mode
      textDark: '#FFFFFF', // White text for dark mode
      textSecondaryLight: '#666666', // Gray text for light mode
      textSecondaryDark: '#B0B0B0', // Light gray text for dark mode
      textTertiaryLight: '#999999', // Lighter gray for light mode
      textTertiaryDark: '#808080', // Medium gray for dark mode
      
      // Border and divider colors
      borderLight: '#E0E0E0', // Light border for light mode
      borderDark: '#333333', // Dark border for dark mode
      dividerLight: '#E5E5E5', // Divider for light mode
      dividerDark: '#2A2A2A', // Divider for dark mode
      
      // Status colors
      success: '#34C759', // Green for success states
      successLight: '#30D158', // Lighter green
      successDark: '#28A745', // Darker green
      error: '#FF3B30', // Red for errors
      errorLight: '#FF453A', // Lighter red
      errorDark: '#D32F2F', // Darker red
      warning: '#FF9500', // Orange for warnings
      warningLight: '#FF9F0A', // Lighter orange
      warningDark: '#F57C00', // Darker orange
      info: '#007AFF', // Blue for info
      infoLight: '#0A84FF', // Lighter blue
      infoDark: '#0051D5', // Darker blue
      
      // Interactive colors
      linkLight: '#007AFF', // Link color for light mode
      linkDark: '#5AC8FA', // Link color for dark mode
      placeholderLight: '#C7C7CC', // Placeholder text light
      placeholderDark: '#6D6D70', // Placeholder text dark
      
      // Overlay and shadow
      overlayLight: 'rgba(0, 0, 0, 0.4)', // Overlay for light mode
      overlayDark: 'rgba(0, 0, 0, 0.6)', // Overlay for dark mode
      shadowLight: 'rgba(0, 0, 0, 0.1)', // Shadow for light mode
      shadowDark: 'rgba(0, 0, 0, 0.3)', // Shadow for dark mode
      
      // Legacy support
      white: '#FFFFFF',
      black: '#000000',
    }
    : {
      // Primary brand colors
      primary: '#697565', // Deep navy blue
      secondary: '#457B9D', // Muted teal
      accent: '#5A9FD4', // Lighter teal for accents
      
      // Trade block colors
      hasBlockGreen: '#B8860B', // Gold for has items
      wantBlockRed: '#E63946', // Warm red for wants
      
      // Background colors
      backgroundLight: '#F2F2F7', // Soft off-white for light mode
      backgroundDark: '#121212', // True black for dark mode
      surfaceLight: '#FFFFFF', // Pure white for cards in light mode
      surfaceDark: '#1E1E1E', // Dark gray for cards in dark mode
      surfaceElevatedLight: '#FFFFFF', // Elevated surfaces light
      surfaceElevatedDark: '#2A2A2A', // Elevated surfaces dark
      
      // Text colors
      textLight: '#000000', // Black text for light mode
      textDark: '#FFFFFF', // White text for dark mode
      textSecondaryLight: '#666666', // Gray text for light mode
      textSecondaryDark: '#B0B0B0', // Light gray text for dark mode
      textTertiaryLight: '#999999', // Lighter gray for light mode
      textTertiaryDark: '#808080', // Medium gray for dark mode
      
      // Border and divider colors
      borderLight: '#E0E0E0', // Light border for light mode
      borderDark: '#333333', // Dark border for dark mode
      dividerLight: '#E5E5E5', // Divider for light mode
      dividerDark: '#2A2A2A', // Divider for dark mode
      
      // Status colors
      success: '#34C759', // Green for success states
      successLight: '#30D158', // Lighter green
      successDark: '#28A745', // Darker green
      error: '#FF3B30', // Red for errors
      errorLight: '#FF453A', // Lighter red
      errorDark: '#D32F2F', // Darker red
      warning: '#FF9500', // Orange for warnings
      warningLight: '#FF9F0A', // Lighter orange
      warningDark: '#F57C00', // Darker orange
      info: '#007AFF', // Blue for info
      infoLight: '#0A84FF', // Lighter blue
      infoDark: '#0051D5', // Darker blue
      
      // Interactive colors
      linkLight: '#007AFF', // Link color for light mode
      linkDark: '#5AC8FA', // Link color for dark mode
      placeholderLight: '#C7C7CC', // Placeholder text light
      placeholderDark: '#6D6D70', // Placeholder text dark
      
      // Overlay and shadow
      overlayLight: 'rgba(0, 0, 0, 0.4)', // Overlay for light mode
      overlayDark: 'rgba(0, 0, 0, 0.6)', // Overlay for dark mode
      shadowLight: 'rgba(0, 0, 0, 0.1)', // Shadow for light mode
      shadowDark: 'rgba(0, 0, 0, 0.3)', // Shadow for dark mode
      
      // Legacy support
      white: '#FFFFFF',
      black: '#000000',
    },

};

export default config;
