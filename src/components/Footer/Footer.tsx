import { useCallback } from 'react';
import { BugIcon, HeartIcon } from '../icons/Icons';
import './Footer.css';

const ISSUES_URL = 'https://github.com/migsilva89/MarkMind/issues';

const Footer = () => {
  const handleOpenLink = useCallback((url: string) => () => {
    chrome.tabs.create({ url });
  }, []);

  return (
    <footer className="footer">
      <span className="footer-version">
        <span className="footer-brand">Markr</span>
        <span className="footer-version-text">v{chrome.runtime.getManifest().version}</span>
      </span>
      <div className="footer-links">
        <span className="footer-made-with">
          Made with <HeartIcon width={10} height={10} /> for productivity
        </span>
        <button
          className="footer-icon-button"
          onClick={handleOpenLink(ISSUES_URL)}
          title="Report a Bug"
        >
          <BugIcon width={12} height={12} />
        </button>
      </div>
    </footer>
  );
};

export default Footer;
