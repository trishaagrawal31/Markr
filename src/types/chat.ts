import { type BulkOrganizeResult } from './organize';

export interface FolderOperation {
  folderId: string;
  folderPath: string;
  operation: 'delete' | 'unpack';
  description: string;
}

export interface ActionPreviewData {
  foldersToCreate: Array<{
    path: string;
    description: string;
  }>;
  affectedBookmarks: Array<{
    id: string;
    title: string;
    url: string;
    currentPath: string;
    suggestedPath: string;
  }>;
  folderOperations?: FolderOperation[];
  summary: string;
  canApprove: boolean;
}

export interface ModelIndicator {
  provider: string;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  status: 'pending' | 'complete' | 'error';
  actionPreview?: ActionPreviewData;
  modelIndicator?: ModelIndicator;
}

export interface ChatResponsePayload {
  message: string;
  actionPreview?: ActionPreviewData;
  modelUsed: ModelIndicator;
  bulkOrganizeResult?: BulkOrganizeResult;
}

export interface ApplyChatActionPayload {
  actionPreview: ActionPreviewData;
}
