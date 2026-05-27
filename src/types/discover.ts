export interface DiscoverCard {
  id: string;
  title: string;
  description: string;
  badgeType?: 'update' | 'new-feature' | 'tip';
  badgeLabel?: string;
  date?: string;
  iconName?: string;
  link?: string;
  tag?: string;
}

export interface DiscoverSubTab {
  id: string;
  label: string;
  iconName: string;
  description: string;
  content?: DiscoverCard[];
}

export interface QuickActionItem {
  id: string;
  title: string;
  description: string;
  iconName?: string;
  colorScheme?: string;
  targetTab?: string;
  externalUrl?: string;
  icon?: string;
  action?: string;
}

export interface PartnerApp {
  id: string;
  name?: string;
  title?: string;
  description: string;
  logoPath?: string;
  logo?: string;
  url?: string;
  category?: string;
}
