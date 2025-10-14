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
      primary: '#6A5ACD', // Muted grayish blue
      secondary: '#3E8BFC', // Bright action blue
      hasBlockGreen: '#6A5ACD', // Vibrant success green
      wantBlockRed: '#6A5ACD', // Vivid warning red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
      white: 'white',
      black: 'black'
    }
    : {
      primary: '#697565', // Deep navy blue
      secondary: '#457B9D', // Muted teal
      hasBlockGreen: '#B8860B', // Light mint green
      wantBlockRed: '#E63946', // Warm, soft red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
      white: 'white',
      black: 'black'
    },

};

export default config;
