// Taqdimot mavzulari: .pptx yasash (server) va brauzerdagi ko'rinish bir xil ranglardan foydalanadi.

export const THEME_IDS = ['okean', 'quyosh', 'zumrad', 'binafsha', 'grafit'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface Theme {
  id: ThemeId;
  name: string;
  dark: boolean;
  /** Sahifa foni */
  bg: string;
  /** Kartalar foni */
  surface: string;
  /** Asosiy rang (sarlavha foni, urg'u) */
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  muted: string;
  /** Asosiy rang ustidagi matn */
  onPrimary: string;
  headFont: string;
  bodyFont: string;
}

// Ranglar "#"siz HEX (pptxgenjs shunday talab qiladi); brauzerda "#" qo'shiladi.
export const THEMES: Record<ThemeId, Theme> = {
  okean: {
    id: 'okean',
    name: 'Okean',
    dark: false,
    bg: 'F6F9FC',
    surface: 'FFFFFF',
    primary: '0B3C5D',
    secondary: '328CC1',
    accent: 'E0A526',
    text: '1B2733',
    muted: '5F7285',
    onPrimary: 'FFFFFF',
    headFont: 'Georgia',
    bodyFont: 'Calibri',
  },
  quyosh: {
    id: 'quyosh',
    name: 'Quyosh',
    dark: false,
    bg: 'FFF8EE',
    surface: 'FFFFFF',
    primary: 'A8431B',
    secondary: 'F0A03C',
    accent: '2E6F6B',
    text: '2B2118',
    muted: '7A6A5A',
    onPrimary: 'FFFFFF',
    headFont: 'Georgia',
    bodyFont: 'Calibri',
  },
  zumrad: {
    id: 'zumrad',
    name: 'Zumrad',
    dark: false,
    bg: 'F3FAF6',
    surface: 'FFFFFF',
    primary: '14532D',
    secondary: '2F9E6B',
    accent: 'F59E0B',
    text: '12261B',
    muted: '5B7566',
    onPrimary: 'FFFFFF',
    headFont: 'Georgia',
    bodyFont: 'Calibri',
  },
  binafsha: {
    id: 'binafsha',
    name: 'Binafsha',
    dark: false,
    bg: 'F8F5FF',
    surface: 'FFFFFF',
    primary: '45197F',
    secondary: '8B5CF6',
    accent: 'EC4899',
    text: '211A33',
    muted: '6B6384',
    onPrimary: 'FFFFFF',
    headFont: 'Georgia',
    bodyFont: 'Calibri',
  },
  grafit: {
    id: 'grafit',
    name: 'Grafit (qorong\'i)',
    dark: true,
    bg: '111827',
    surface: '1F2937',
    primary: '0EA5E9',
    secondary: '38BDF8',
    accent: 'FBBF24',
    text: 'F3F4F6',
    muted: '9CA3AF',
    onPrimary: '0B1220',
    headFont: 'Georgia',
    bodyFont: 'Calibri',
  },
};

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}
