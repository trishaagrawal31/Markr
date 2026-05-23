export type ColorScheme = 'green' | 'purple' | 'orange' | 'cyan';

export interface QuickActionItem {
  id: string;
  title: string;
  description: string;
  iconName: string;
  colorScheme: ColorScheme;
  targetTab: string;
  externalUrl?: string;
}

export interface PartnerApp {
  id: string;
  title: string;
  description: string;
  url: string;
  logoPath: string;
}

