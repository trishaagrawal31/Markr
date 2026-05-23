import { type CompactBookmark, type BulkOrganizeResult } from './organize';
import { type FolderPathMap } from './bookmarks';
import { type ChatResponsePayload, type ApplyChatActionPayload } from './chat';

export type OrganizeMessageType =
  | 'START_ORGANIZE'
  | 'GET_ORGANIZE_STATUS'
  | 'ORGANIZE_COMPLETE'
  | 'ORGANIZE_ERROR'
  | 'CHAT_REQUEST'
  | 'CHAT_RESPONSE'
  | 'APPLY_CHAT_ACTION'
  | 'CHAT_ACTION_COMPLETE'
  | 'CHAT_ACTION_ERROR';

export interface OrganizeMessage {
  type: OrganizeMessageType;
  payload?: unknown;
}

export interface StartOrganizePayload {
  serviceId: string;
  modelId: string;
  bookmarks: CompactBookmark[];
  folderTree: string;
  pathToIdMap: FolderPathMap;
  defaultParentId: string;
  maxOutputTokens?: number;
  userInstructions?: string;
}

export interface ChatRequestPayload {
  message: string;
  serviceId: string;
  modelId: string;
  folderTree: string;
  pathToIdMap: FolderPathMap;
  maxOutputTokens?: number;
}

export interface OrganizeCompletePayload {
  result: BulkOrganizeResult;
}

export interface OrganizeErrorPayload {
  errorMessage: string;
}

export interface ChatResponseMessage {
  type: 'CHAT_RESPONSE';
  payload: ChatResponsePayload;
}

export interface ApplyChatActionMessage {
  type: 'APPLY_CHAT_ACTION';
  payload: ApplyChatActionPayload;
}

export interface ChatActionCompletePayload {
  appliedCount: number;
  skippedCount: number;
}

export interface ChatActionErrorPayload {
  errorMessage: string;
}
