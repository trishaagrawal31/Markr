import { useState, useCallback } from 'react';
import TabNavigation from '../TabNavigation/TabNavigation';
import HomeTab from '../tabs/HomeTab';
import OrganizeTab from '../tabs/OrganizeTab';

import ChatTab from '../../ChatTab';
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
  showOnboardingTooltips,
  onTooltipsDismissed,
}: MainContentProps) => {
  const [activeTab, setActiveTab] = useState('home');

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
  }, []);

  return (
    <div className="container">
      <TabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        showOrganizeTooltip={showOnboardingTooltips && activeTab === 'organize'}
        onDismissOrganizeTooltip={onTooltipsDismissed}
      />
      
      <main className="main-content">
        {activeTab === 'home' && (
  <HomeTab 
    onTabChange={handleTabChange}
    onOpenSettings={onOpenSettings} 
    showCardTooltip={showOnboardingTooltips} // check if this is your variable name from above
    onDismissCardTooltip={onTooltipsDismissed} // check if this is your variable name from above
  />
)}
        {activeTab === 'organize' && <OrganizeTab />}
        {activeTab === 'chat' && <ChatTab />}

      </main>
    </div>
  );
};

export default MainContent;