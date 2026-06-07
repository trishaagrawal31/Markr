import { useCallback } from 'react';
import { HomeIcon, FolderIcon, MessageSquareIcon, SettingsIcon } from '../icons/Icons';
import Button from '../Button/Button';
import OnboardingTooltip from '../OnboardingTooltip/OnboardingTooltip';
import './TabNavigation.css';

interface TabConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ width?: number; height?: number }>;
}

const TAB_CONFIG: TabConfig[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'organize', label: 'Organize', icon: FolderIcon },
  { id: 'chat', label: 'Chat', icon: MessageSquareIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  showOrganizeTooltip?: boolean;
  onDismissOrganizeTooltip?: () => void;
}

const TabNavigation = ({
  activeTab,
  onTabChange,
  showOrganizeTooltip = false,
  onDismissOrganizeTooltip,
}: TabNavigationProps) => {
  const handleTabClick = useCallback(
    (tabConfig: TabConfig) => () => {
      onTabChange(tabConfig.id);
    },
    [onTabChange]
  );

  return (
    <div className="tab-navigation-wrapper">
      <nav className="tab-navigation">
        {TAB_CONFIG.map((tabConfig) => {
          const TabIcon = tabConfig.icon;
          return (
            <Button
              key={tabConfig.id}
              variant="ghost"
              active={activeTab === tabConfig.id}
              onClick={handleTabClick(tabConfig)}
              className="tab-navigation-button"
            >
              <TabIcon width={18} height={18} />
              {tabConfig.label}
            </Button>
          );
        })}
      </nav>
      {showOrganizeTooltip && onDismissOrganizeTooltip && (
        <div className="tab-navigation-tooltip">
          <OnboardingTooltip
            content="Got messy bookmarks? This is where the magic happens."
            onDismiss={onDismissOrganizeTooltip}
          />
        </div>
      )}
    </div>
  );
};

export default TabNavigation;
