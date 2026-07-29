import { StyleSheet } from "react-native";
import config from "../Helper/Environment";

export const getStyles = (isDarkMode) =>

  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f2f2f7',
    },
    loader: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chatList: {
      flexGrow: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: 6,
      paddingVertical: 5,
    },
    mymessageBubble: {
      flexDirection: "row-reverse",
      marginBottom: 12,
      alignItems: 'flex-end',
    },
    othermessageBubble: {
      flexDirection: 'row',
      marginBottom: 12,
      alignItems: 'flex-start',
    },
    myBubbleContent: {
      backgroundColor: isDarkMode ? '#0B5E3F' : '#DCF8C6',
      borderRadius: 18,
      borderTopRightRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    otherBubbleContent: {
      backgroundColor: isDarkMode ? config.colors.surfaceDark : '#E5E5EA',
      borderRadius: 18,
      borderTopLeftRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bubbleInner: {
      flexDirection: 'column',
    },
    myMessage: {
      alignSelf: 'flex-end',
    },
    otherMessage: {
      alignSelf: 'flex-start',

    },
    // Avatar slot in a chat row. Must NOT constrain width/height or set a
    // borderRadius: FramedAvatar paints an SVG larger than its avatarSize
    // (border + gap + room for crowns/wings) and needs overflow visible. The
    // old fixed 34x32 + borderRadius:16 box clipped every frame's decorations.
    senderName: {
      marginBottom: 2,
      marginHorizontal: 5,
    },
    senderNameText: {
      fontSize: 11,
      fontFamily: 'Lato-Bold',
      color: 'grey',
    },
    messageTextBox: {
      maxWidth: '82%',
      marginHorizontal: 8,
    },
    messageTextBoxAdmin: {
      flexDirection: 'column',
      flex: 1,

    },
    myMessageText: {
      fontSize: 13,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Regular',
      lineHeight: 18,
    },
    otherMessageText: {
      fontSize: 13,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Regular',
      lineHeight: 18,
    },
    myMessageTextOnly: {
      fontSize: 14,
      color: isDarkMode ? '#FFFFFF' : '#000000',
      fontFamily: 'Lato-Regular',
      lineHeight: 18,
      textAlign: 'left',
    },
    otherMessageTextOnly: {
      fontSize: 14,
      color: isDarkMode ? '#FFFFFF' : '#000000',
      fontFamily: 'Lato-Regular',
      lineHeight: 18,
      textAlign: 'left',
    },
    timestamp: {
      fontSize: 10,
      color: isDarkMode ? 'lightgrey' : 'grey',
      textAlign: 'right',
      paddingHorizontal: 5
    },
    input: {
      flex: 1, // Ensures the input takes available space
      borderRadius: 20,
      padding: 5,
      marginRight: 10,
      fontSize: 16,
      minHeight: 30, // ✅ Fixed typo: heighteight -> minHeight
      maxHeight: 120, // Limit input growth to a max height
      textAlignVertical: 'top', // Ensures text starts at the top
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    },

    // sendButton: {
    //   borderRadius: 20,
    //   // paddingVertical: 10,
    //   paddingHorizontal: 20,
    //   // backgroundColor:config.colors.primary
    // },
    // sendButtonText: {
    //   color: '#fff',
    //   fontSize: 16,
    //   fontFamily: 'Lato-Bold',
    // },
    loggedOutMessage: {
      flex: 1,
      fontSize: 16,
      paddingVertical: 10,
    },
    loggedOutMessageText: {
      color: '#bbb',
      textAlign: 'center',
    },
    dateSeparator: {
      fontSize: 14,
      color: '#888',
      textAlign: 'center',
      marginVertical: 10,
    },

    platformText: {
      color: 'white',
      fontSize: 6,
      fontFamily: 'Lato-Bold',
    },
   
    admin: {
      // alignSelf: 'flex-start',
      color: 'white',
      // fontSize: 10,
      fontFamily: 'Lato-Bold',
      // color: config.colors.primary,
      fontSize: 9,
    },
    verifiedContainer: {
      backgroundColor: '#4CAF50',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 3,
      marginLeft: 4,
    },
    verified: {
      color: 'white',
      fontSize: 9,
      fontFamily: 'Lato-Bold',
      // lineHeight:10,

      
    },
    adminText: {
      fontSize: 12,
      color: 'white',
      paddingTop: 5
    },
    login: {
      height: 40,
      justifyContent: 'center',
      color: config.colors.hasBlockGreen,
      alignSelf: 'center',
      width: '100%',
      borderTopWidth: 1,
      borderColor: isDarkMode ? '#333333' : '#cccccc',

      //  borderRadius:10

    },
    loginText: {
      color: config.colors.hasBlockGreen,
      fontFamily: 'Lato-Bold',
      textAlign: 'center',
      lineHeight: 24

    },
    inputWrapper: {
      paddingHorizontal: 10,
      paddingVertical:3,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? config.colors.borderDark : '#ddd',
      backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
    },
    cancelReplyButton: {
      alignSelf: 'flex-end',

    },
    cancelReplyText: {
      color: '#E74C3C',
      fontSize: 12,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
    },
    // input: {
    //   flex: 1,
    //   backgroundColor: isDarkMode ? '#333' : '#f0f0f0',
    //   borderRadius: 20,
    //   paddingHorizontal: 15,
    //   paddingVertical: 10,
    //   fontSize: 16,
    // },
    sendButton: {
      marginLeft: 5,
      borderRadius: 20,
      paddingHorizontal: 20,
      paddingVertical: 5,
    },
    sendButtonText: {
      color: '#fff',
      fontSize: 16,
    },
    replyContainer: {
      backgroundColor: isDarkMode ? config.colors.surfaceDark : '#f0f0f0',
      borderLeftWidth: 3,
      borderLeftColor: isDarkMode ? '#1E88E5' : '#007BFF',
      padding: 5,
      marginBottom: 5,
      borderRadius: 5,
    },
    replyText: {
      fontSize: 10,
      color: isDarkMode ? '#1E88E5' : '#007BFF',
      width: '95%'

    },
    replySenderText: {
      fontSize: 12,
      fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#FFF' : '#000',
    },
    profileImage: {
      height: 34,
      width: 34,
      borderRadius: 17,
      backgroundColor:'white'
    },
    profileImagePvtChat: {
      height: 30,
      width: 30,
      borderRadius: 15,
      marginHorizontal: 5,
      backgroundColor:'white'
    },

    userName: {
      color: isDarkMode ? 'lightfrey' : 'grey',
      fontSize: 10,
      justifyContent:'center',
      // backgroundColor:'red',
      backgroundColor:'red',
      lineHeight:14,
      fontFamily:'Lato-Bold'

    },
    adminActions: {
      // flexDirection: 'row',
      justifyContent:'center',
      // alignItems:'flex-end',
      // overflow:'hidden',
      // flexWrap:"wrap"
    },
    adminTextAction: {
      backgroundColor: config.colors.wantBlockRed,
      marginHorizontal: 3,
      padding: 10,
      borderRadius: 3,
      color: 'white',
      alignSelf: 'center',
      minWidth: 150,
      // fontSize:10
      },
    dot: {
      color: '#bbb',
      marginHorizontal: 5,
      fontSize: 14
    },
    linkText: {
      color: '#1E90FF', // Blue color for links
      textDecorationLine: 'underline', // Underline to indicate a link
    },
 
    menu: {
      borderRadius: 20,
      // backgroundColor:'red'
    },
    menuTrig: {
      borderRadius: 50,
      // backgroundColor: 'red',
      marginBottom: 100

    },
    menuoptions: {
      minWidth: 150,
      maxWidth: 200,
      borderRadius: 12,
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : '#FFFFFF',
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 10,
      elevation: 6,
    },
    menuOption: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth:StyleSheet.hairlineWidth,
      borderBottomColor: isDarkMode ? '#334155' : '#E5E7EB',
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : '#FFFFFF',
      justifyContent: 'center',
    },
    menuOptionText: {
      fontSize: 15,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#F8FAFC' : '#111827',
    },
    menuOptionTextDanger: {
      fontSize: 15,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#F87171' : '#EF4444',
    },
    reportIcon:{
      position:'absolute',
      right:2,
      top:2,
      opacity:1,
      color:config.colors.wantBlockRed,
      fontSize:8,
      fontStyle:'italic'

    },
    reportedMessage: {
      opacity: .3, // Light blue color
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      // backgroundColor:'red'

    },
    emptyText:{
      color: isDarkMode ? 'white' : 'black',
    },
    // Shown above the input when a chat-availability switch closes this door.
    chatUnavailableBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#3f1d1d' : '#fde8e8',
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? '#7f1d1d' : '#f5c2c2',
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    chatUnavailableIcon: {
      fontSize: 14,
      marginRight: 8,
    },
    chatUnavailableText: {
      flex: 1,
      fontSize: 12.5,
      fontWeight: '600',
      lineHeight: 17,
      color: isDarkMode ? '#fca5a5' : '#991b1b',
    },
tradeDetails: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  backgroundColor: 'grey',
  paddingHorizontal:10


},
itemList: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'space-evenly',
  width: "45%",
  paddingVertical: 0,
  // backgroundColor:'red'
},
itemImage: {
  width: 30,
  height: 30,
  // marginRight: 5,
  // borderRadius: 25,
  marginVertical: 5,
  borderRadius: 5
  // padding:10

},

transferImage: {
  width: 15,
  height: 15,
  // marginRight: 5,
  borderRadius: 5,
},
tradeTotals: {
  flexDirection: 'row',
  justifyContent: 'center',
  // marginTop: 10,
  width: '100%'

},
names:{
  fontSize: 8,
  color:'white'
},
priceText: {
  fontSize: 10,
  fontFamily: 'Lato-Regular',
  color: '#007BFF',
  // width: '40%',
  textAlign: 'center', // Centers text within its own width
  alignSelf: 'center', // Centers within the parent container
  color: 'white', // ✅ Removed redundant conditional
  marginHorizontal: 'auto',
  paddingHorizontal: 4,
  paddingVertical: 2,
  borderRadius: 6
},
priceTextProfit: {
  fontSize: 10,
  lineHeight:14,
  fontFamily: 'Lato-Regular',
  // color: '#007BFF',
  // width: '40%',
  textAlign: 'center', // Centers text within its own width
  alignSelf: 'center', // Centers within the parent container
  // color: isDarkMode ? 'white' : "grey",
  // marginHorizontal: 'auto',
  // paddingHorizontal: 4,
  // paddingVertical: 2,
  // borderRadius: 6
},
tagcount: {
  position: 'absolute',
  backgroundColor: 'purple',
  top: 4,
  left: 1,
  borderRadius: 50,
  paddingHorizontal: 3,
  paddingBottom: 2

},
tagcounttext: {
  color: 'white',
  fontFamily: 'Lato-Bold',
  fontSize: 10
},

hasBackground: {
  backgroundColor: config.colors.hasBlockGreen,
},
wantBackground: {
  backgroundColor: config.colors.wantBlockRed,
},
tradeActions: {
  flexDirection: 'row',
  alignItems: 'center',
},

transfer: {
  width: '10%',
  justifyContent: 'center',
  alignItems: 'center'
},
deleteButton:{
  paddingVertical:5
},
chatImage: {
  width: 200,
  height: 200,
  borderRadius: 8,
  marginBottom: 4,
},
saveButtonTextProfile:{
  color: isDarkMode ? 'white' : "black",
},
highlightedMessage: {
  backgroundColor: '#fef3c7',      // soft yellow
  borderColor: '#f59e0b',
  borderWidth: 1,
},
nameRow: {
  flexDirection: 'row',
  alignItems: 'center',      // vertical alignment (text + images)
  // justifyContent: 'center',  // center the whole row horizontally
},

userNameText: {
  color: isDarkMode ? 'lightgrey' : 'grey',
  fontSize: 10,
  lineHeight: 14,
  paddingTop: 0,
  marginBottom: 2,
},
userNameTextMy: {
  color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)',
  fontSize: 10,
  lineHeight: 14,
  paddingTop: 0,
  marginBottom: 2,
},
userNameAdmin: {
  color: 'white',
  fontSize: 9,
  lineHeight: 11,
},

icon: {
  width: 10,
  height: 10,
  marginLeft: 4,
  // paddingBottom:5
},

adminContainer: {
  marginLeft: 4,
  paddingHorizontal: 4,
  paddingVertical: 1,
  borderRadius: 4,
  backgroundColor: config.colors.primary, // your choice
  alignItems: 'center',
  justifyContent: 'center',
},

platformBadge: {
  marginLeft: 6,
  // paddingHorizontal: 3,
  // paddingVertical: 1,
  borderRadius: '50%',
  alignItems: 'center',
  justifyContent: 'center',
},
scrollToBottomButton: {
  position: 'absolute',
  bottom: 80,
  right: 8,
  marginTop: -24, // Half of icon size (48/2) to center it perfectly
  zIndex: 1000,
  elevation: 8, // For Android shadow
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.25,
  shadowRadius: 4,
},
scrollToBottomTouchable: {
  borderRadius: 24,
  // padding: 4,
  justifyContent: 'center',
  alignItems: 'center',
},

  });