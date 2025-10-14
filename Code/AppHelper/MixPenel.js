import { Mixpanel } from "mixpanel-react-native";

const trackAutomaticEvents = true;
export const mixpanel = new Mixpanel("66ff639ebe0bc7768290e54a73c34f59", trackAutomaticEvents);
mixpanel.init();

