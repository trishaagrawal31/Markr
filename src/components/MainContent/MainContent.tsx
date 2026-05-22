import { useState, useCallback } from 'react';
import { HomeIcon, FolderIcon, CompassIcon, SettingsIcon, SunIcon, MoonIcon, BookOpenIcon, ExternalLinkIcon } from '../icons/Icons';
import HomeTab from '../tabs/HomeTab';
import OrganizeTab from '../tabs/OrganizeTab';
import DiscoverTab from '../tabs/DiscoverTab';
import { MARKR_BLOG_URL } from '../../config/discoverContent';
import { ResolvedTheme } from '../../hooks/useTheme';
import './MainContent.css';

interface MainContentProps {
  onOpenSettings: () => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  showOnboardingTooltips?: boolean;
  onTooltipsDismissed?: () => void;
}

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'organize', label: 'Organize', icon: FolderIcon },
  { id: 'discover', label: 'Discover', icon: CompassIcon },
];

const TAB_TITLES: Record<string, { title: string; subtitle: string }> = {
  home: { title: 'Home', subtitle: 'Save and manage bookmarks' },
  organize: { title: 'Organize', subtitle: 'AI-powered bookmark organization' },
  discover: { title: 'Discover', subtitle: 'Explore features and resources' },
};

const MainContent = ({
  onOpenSettings,
  theme,
  onToggleTheme,
  showOnboardingTooltips = false,
  onTooltipsDismissed,
}: MainContentProps) => {
  const [activeTab, setActiveTab] = useState('home');
  const [tooltipStep, setTooltipStep] = useState<'card' | 'organize' | 'done'>(
    showOnboardingTooltips ? 'card' : 'done'
  );

  const handleTabChange = useCallback((tabId: string): void => {
    if (tooltipStep !== 'done') {
      setTooltipStep('done');
      onTooltipsDismissed?.();
    }
    setActiveTab(tabId);
  }, [tooltipStep, onTooltipsDismissed]);

  const handleDismissCardTooltip = useCallback((): void => {
    setTooltipStep('organize');
  }, []);

  const handleDismissOrganizeTooltip = useCallback((): void => {
    setTooltipStep('done');
    onTooltipsDismissed?.();
  }, [onTooltipsDismissed]);

  const handleOpenBlog = useCallback((): void => {
    chrome.tabs.create({ url: MARKR_BLOG_URL });
  }, []);

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'organize':
        return <OrganizeTab />;
      case 'discover':
        return <DiscoverTab />;
      case 'home':
      default:
        return (
          <HomeTab
            onTabChange={handleTabChange}
            onOpenSettings={onOpenSettings}
            showCardTooltip={tooltipStep === 'card'}
            onDismissCardTooltip={handleDismissCardTooltip}
          />
        );
    }
  };

  const currentTab = TAB_TITLES[activeTab] || TAB_TITLES.home;

  return (
    <>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/assets/icons/icon48.png" alt="Markr" />
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => handleTabChange(item.id)}
                title={item.label}
              >
                <Icon width={18} height={18} />
              </button>
            );
          })}
          
          <button
            className="sidebar-nav-item"
            onClick={handleOpenBlog}
            title="Blog"
          >
            <BookOpenIcon width={18} height={18} />
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            className="sidebar-nav-item"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
          </button>
          <button
            className="sidebar-nav-item"
            onClick={onOpenSettings}
            title="Settings"
          >
            <SettingsIcon width={16} height={16} />
          </button>
        </div>
      </aside>

      {/* Main Area */}
      <div className="main-area">
        <header className="main-header">
          <div className="main-header-left">
            <h1 className="main-header-title">{currentTab.title}</h1>
            <p className="main-header-subtitle">{currentTab.subtitle}</p>
          </div>
        </header>

        <main className="main-content fade-in" key={activeTab}>
          {renderActiveTab()}
        </main>
      </div>
    </>
  );
};

export default MainContent;
