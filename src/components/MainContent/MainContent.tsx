import { useState, useCallback } from 'react';
import TabNavigation from '../TabNavigation/TabNavigation';
import HomeTab from '../tabs/HomeTab';
import OrganizeTab from '../tabs/OrganizeTab';
import ChatTab from '../../ChatTab';
import Button from '../Button/Button';
import { SunIcon, MoonIcon } from '../icons/Icons';
import './MainContent.css';

interface MainContentProps {
  onOpenSettings: () => void;
  theme?: string;
  onToggleTheme?: () => void;
  showOnboardingTooltips: boolean;
  onTooltipsDismissed: () => void;
}

const MainContent = ({
  onOpenSettings,
  theme,
  onToggleTheme,
  showOnboardingTooltips,
  onTooltipsDismissed,
}: MainContentProps) => {
  const [activeTab, setActiveTab] = useState('home');

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
  }, []);

  return (
    <div className="container">
      <header className="main-header">
        <div className="main-header-left">
          <img
            src="/assets/icons/icon48.png"
            alt="MarkMind"
            className="main-header-logo"
          />
          <h1 className="main-header-title">MarkMind</h1>
        </div>
        {onToggleTheme && (
          <div className="main-header-right">
            <Button
              variant="icon"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </Button>
          </div>
        )}
      </header>

      <TabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenSettings={onOpenSettings}
        showOrganizeTooltip={showOnboardingTooltips && activeTab === 'organize'}
        onDismissOrganizeTooltip={onTooltipsDismissed}
      />
      
      <main className="main-content">
        {activeTab === 'home' && (
  <HomeTab 
    onTabChange={handleTabChange}
    onOpenSettings={onOpenSettings} 
    showCardTooltip={showOnboardingTooltips}
    onDismissCardTooltip={onTooltipsDismissed} 
  />
)}
        {activeTab === 'organize' && <OrganizeTab />}
        {activeTab === 'chat' && <ChatTab />}

      </main>
    </div>
  );
};

export default MainContent;
