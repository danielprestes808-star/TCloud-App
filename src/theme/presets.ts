import { CustomTheme } from './themeEngine';

/** Built-in theme presets. Users cannot delete these. */
export const BUILTIN_THEMES: CustomTheme[] = [
  {
    id: 'default-dark',
    name: 'Default Dark',
    isDark: true,
    isBuiltin: true,
    palette: {
      bg: '#101114',
      surface: '#1b1c20',
      primary: '#2aabee',
      secondary: '#63a9ff',
      text: '#f7f7f5',
      subtext: '#b2b3ba',
      border: 'rgba(255, 255, 255, 0.1)',
      hover: 'rgba(255, 255, 255, 0.055)',
    },
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    isDark: true,
    isBuiltin: true,
    palette: {
      bg: '#1e1e2e',
      surface: '#282838',
      primary: '#6c63ff',
      secondary: '#a78bfa',
      text: '#e4e4ef',
      subtext: '#8888a8',
      border: 'rgba(255, 255, 255, 0.08)',
      hover: 'rgba(255, 255, 255, 0.04)',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    isDark: true,
    isBuiltin: true,
    palette: {
      bg: '#2e3440',
      surface: '#3b4252',
      primary: '#88c0d0',
      secondary: '#81a1c1',
      text: '#eceff4',
      subtext: '#a3b1c6',
      border: 'rgba(255, 255, 255, 0.08)',
      hover: 'rgba(255, 255, 255, 0.04)',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    isDark: true,
    isBuiltin: true,
    palette: {
      bg: '#272822',
      surface: '#2f302a',
      primary: '#a6e22e',
      secondary: '#66d9ef',
      text: '#f8f8f2',
      subtext: '#90908a',
      border: 'rgba(255, 255, 255, 0.08)',
      hover: 'rgba(255, 255, 255, 0.04)',
    },
  },
  {
    id: 'cyber-teal',
    name: 'Cyber Teal',
    isDark: true,
    isBuiltin: true,
    palette: {
      bg: '#0a1628',
      surface: '#112240',
      primary: '#00e5bf',
      secondary: '#00b4d8',
      text: '#e0f7f4',
      subtext: '#6faaaf',
      border: 'rgba(0, 229, 191, 0.12)',
      hover: 'rgba(0, 229, 191, 0.06)',
    },
  },
  {
    id: 'default-light',
    name: 'Default Light',
    isDark: false,
    isBuiltin: true,
    palette: {
      bg: '#f5f5f2',
      surface: '#fbfbf9',
      primary: '#168ac3',
      secondary: '#2479c8',
      text: '#1b1c1f',
      subtext: '#5d6068',
      border: 'rgba(0, 0, 0, 0.1)',
      hover: 'rgba(27, 28, 31, 0.05)',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    isDark: false,
    isBuiltin: true,
    palette: {
      bg: '#fdf6e3',
      surface: '#eee8d5',
      primary: '#b58900',
      secondary: '#268bd2',
      text: '#073642',
      subtext: '#586e75',
      border: 'rgba(0, 0, 0, 0.1)',
      hover: 'rgba(0, 0, 0, 0.04)',
    },
  },
  {
    id: 'midnight-blue',
    name: 'Midnight Blue',
    isDark: true,
    isBuiltin: true,
    palette: { bg: '#080d18', surface: '#101827', primary: '#3b82f6', secondary: '#60a5fa', text: '#edf4ff', subtext: '#96a5bc', border: '#29364a', hover: '#182338' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    isDark: true,
    isBuiltin: true,
    palette: { bg: '#111315', surface: '#1a1d20', primary: '#8ba3bd', secondary: '#b4c5d6', text: '#f0f2f4', subtext: '#9ba3ab', border: '#343a40', hover: '#24292e' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    isDark: true,
    isBuiltin: true,
    palette: { bg: '#07151c', surface: '#0d222d', primary: '#2f9fc2', secondary: '#6dc4dc', text: '#e8f7fb', subtext: '#8eabb5', border: '#24424e', hover: '#15313d' },
  },
  {
    id: 'cloud-light',
    name: 'Cloud Light',
    isDark: false,
    isBuiltin: true,
    palette: { bg: '#f3f6fa', surface: '#ffffff', primary: '#245fae', secondary: '#4b7fbd', text: '#172033', subtext: '#627087', border: '#d7dee8', hover: '#e9eef5' },
  },
];

/** Default palette values to seed a new custom theme. */
export function getDefaultPalette(isDark: boolean) {
  const base = isDark
    ? BUILTIN_THEMES.find(t => t.id === 'default-dark')!
    : BUILTIN_THEMES.find(t => t.id === 'default-light')!;
  return { ...base.palette };
}
