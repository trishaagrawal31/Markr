import React from 'react';
import { CheckCircleIcon, XCircleIcon, FolderPlusIcon } from '../icons/Icons';
import Button from '../Button/Button';
import './ActionPreview.css';
import { type ActionPreviewData } from '../../types/chat';

interface ActionPreviewProps {
  actionPreview: ActionPreviewData;
  onApprove: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const ActionPreview: React.FC<ActionPreviewProps> = ({
  actionPreview,
  onApprove,
  onCancel,
  isLoading = false,
}) => {
  return (
    <div className="action-preview-container">
      <div className="action-preview-header">
        <div className="action-preview-title">
          <FolderPlusIcon width={16} height={16} />
          Review Changes
        </div>
      </div>

      <div className="action-preview-content">
        {/* Folders Section */}
        {actionPreview.foldersToCreate.length > 0 && (
          <div className="action-preview-section">
            <div className="section-header">
              <span className="section-label">📁 Folders to Create</span>
              <span className="section-count">{actionPreview.foldersToCreate.length}</span>
            </div>
            <div className="folders-list">
              {actionPreview.foldersToCreate.map((folder, idx) => (
                <div key={idx} className="folder-item">
                  <div className="folder-path">{folder.path}</div>
                  {folder.description && (
                    <div className="folder-description">{folder.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bookmarks Section */}
        {actionPreview.affectedBookmarks.length > 0 && (
          <div className="action-preview-section">
            <div className="section-header">
              <span className="section-label">🔗 Bookmarks Moving</span>
              <span className="section-count">{actionPreview.affectedBookmarks.length}</span>
            </div>
            <div className="bookmarks-scroll">
              {actionPreview.affectedBookmarks.map((bookmark) => (
                <div key={bookmark.id} className="bookmark-item">
                  <div className="bookmark-header">
                    <span className="bookmark-title" title={bookmark.title}>
                      {bookmark.title}
                    </span>
                  </div>
                  <div className="bookmark-url" title={bookmark.url}>
                    {new URL(bookmark.url).hostname}
                  </div>
                  <div className="bookmark-paths">
                    <div className="path-row">
                      <span className="path-label">From:</span>
                      <span className="path-value current">{bookmark.currentPath}</span>
                    </div>
                    <div className="path-row">
                      <span className="path-label">To:</span>
                      <span className="path-value suggested">{bookmark.suggestedPath}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="action-preview-summary">
          <p>{actionPreview.summary}</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="action-preview-footer">
        <Button
          variant="ghost"
          disabled={isLoading}
          onClick={onCancel}
          className="action-button cancel-button"
        >
          <XCircleIcon width={14} height={14} />
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={isLoading || !actionPreview.canApprove}
          onClick={onApprove}
          className="action-button approve-button"
        >
          <CheckCircleIcon width={14} height={14} />
          {isLoading ? 'Applying...' : 'Apply Changes'}
        </Button>
      </div>
    </div>
  );
};

export default ActionPreview;
