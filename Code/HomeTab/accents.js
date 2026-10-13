// accents.js — one hue per tool, shared by Home and the More hub.
//
// Tuned per theme: dark mode needs a LIGHTER ink on a dark tint, not the light
// ink on a darker background (that measured ~2.5 contrast in Fisch). Same
// values as FischValues/Code/Design/tokens.js ACCENT.
export const ACCENT = {
  //         light-mode ink   light tint   dark-mode ink   dark tint
  blue:   { light: '#2F5FB8', tintLight: '#E1EAF8', dark: '#7FA6EC', tintDark: '#172A4C' },
  coral:  { light: '#C2453F', tintLight: '#FBE6E4', dark: '#EC8B84', tintDark: '#48201E' },
  amber:  { light: '#B06E12', tintLight: '#FBEFDB', dark: '#E3A445', tintDark: '#41300F' },
  violet: { light: '#6247B5', tintLight: '#EAE5F8', dark: '#A692EC', tintDark: '#282050' },
  kelp:   { light: '#237A55', tintLight: '#DFF1E8', dark: '#5EC395', tintDark: '#123A2A' },
  rose:   { light: '#B33A72', tintLight: '#FAE4EE', dark: '#E883B0', tintDark: '#3F1A2D' },
};

export const accentFor = (name, dark) => {
  const a = ACCENT[name] || ACCENT.violet;
  return { color: dark ? a.dark : a.light, tint: dark ? a.tintDark : a.tintLight };
};
