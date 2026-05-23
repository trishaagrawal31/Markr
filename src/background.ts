import { type OrganizeMessage, type StartOrganizePayload, type ChatRequestPayload } from './types/messaging';
import { type OrganizeSession } from './types/organize';
import { organizeBookmarks } from './services/ai/bulkOrganize';
import { saveOrganizeSession, loadOrganizeSession, getInitialSession } from './services/organizeSession';
import { type ActionPreviewData, type ChatResponsePayload, type ApplyChatActionPayload } from './types/chat';
import { moveBookmark, createFolderPath, getFullBookmarkLibrary } from './services/bookmarks';
import { buildFullIdToPathMapFromTree } from './utils/folders';

const KEEPALIVE_ALARM_NAME = 'organize-keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.4;

const notifyPopup = (type: string, payload?: unknown): void => {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // Popup might be closed — this is expected
  });
};

const buildActionPreviewFromResult = (
  result: Awaited<ReturnType<typeof organizeBookmarks>>
): ActionPreviewData => {
  const foldersToCreate = result.folderPlan.folders
    .filter(f => f.isNew)
    .map(f => ({
      path: f.path,
      description: f.description,
    }));

  const affectedBookmarks = result.assignments.map(a => ({
    id: a.bookmarkId,
    title: a.bookmarkTitle,
    url: a.bookmarkUrl,
    currentPath: a.currentPath,
    suggestedPath: a.suggestedPath,
  }));

  return {
    foldersToCreate,
    affectedBookmarks,
    summary: result.folderPlan.summary,
    canApprove: affectedBookmarks.length > 0,
  };
};

const handleStartOrganize = async (payload: StartOrganizePayload): Promise<void> => {
  chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
  });

  const result = await organizeBookmarks(
    payload.serviceId,
    payload.modelId,
    payload.bookmarks,
    payload.folderTree,
    payload.pathToIdMap,
    payload.maxOutputTokens,
    payload.userInstructions
  );

  // Merge AI results into the existing session (or a fresh one if storage read fails)
  const existingSession = await loadOrganizeSession() ?? getInitialSession();

  // User may have cancelled while the AI call was in flight — do not overwrite
  if (existingSession.status !== 'organizing') {
    chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
    return;
  }

  const completedSession: OrganizeSession = {
    ...existingSession,
    status: 'reviewing_assignments',
    folderPlan: result.folderPlan,
    assignments: result.assignments,
    serviceId: payload.serviceId,
    folderTree: payload.folderTree,
    pathToIdMap: payload.pathToIdMap,
    defaultParentId: payload.defaultParentId,
  };

  await saveOrganizeSession(completedSession);
  chrome.alarms.clear(KEEPALIVE_ALARM_NAME);

  notifyPopup('ORGANIZE_COMPLETE', { result });
};

const handleChatRequest = async (payload: ChatRequestPayload): Promise<void> => {
  try {
    // Get comprehensive bookmark context (not just open tabs)
    const tree = await chrome.bookmarks.getTree();

    // Get ALL bookmarks in the library
    const allBookmarks = await getFullBookmarkLibrary();

    // Also get open tabs for context
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const openTabBookmarks = tabs
      .filter(t => t.url && !t.url.startsWith('chrome://'))
      .map(t => ({
        id: `tab-${t.id}`,
        title: t.title || 'Untitled Tab',
        url: t.url || '',
        currentFolderPath: 'Open Tabs',
        currentFolderId: 'root',
      }));

    // Build folder structure info
    const pathToIdMap: Record<string, string> = {};
    const idToPathMap = buildFullIdToPathMapFromTree(tree);
    Object.entries(idToPathMap).forEach(([id, path]) => {
      pathToIdMap[path] = id;
    });

    let folderTree = '';
    try {
      folderTree = JSON.stringify(tree, null, 2);
    } catch (e) {
      // Ignore tree serialization errors
    }

    // If the user explicitly mentions "open tabs", focus on those
    // Otherwise, search through entire bookmark library + open tabs
    const includeOpenTabsOnly =
      payload.message.toLowerCase().includes('open') &&
      payload.message.toLowerCase().includes('tabs');

    const bookmarksToAnalyze = includeOpenTabsOnly ? openTabBookmarks : allBookmarks;

    // Call AI with the comprehensive context
    const result = await organizeBookmarks(
      payload.serviceId,
      payload.modelId,
      bookmarksToAnalyze,
      folderTree,
      pathToIdMap,
      payload.maxOutputTokens,
      payload.message
    );

    // Build ActionPreviewData from result
    const actionPreview = buildActionPreviewFromResult(result);

    // Send response to popup with action preview
    const response: ChatResponsePayload = {
      message: `I've analyzed your request. Here's my plan:`,
      actionPreview,
      modelUsed: {
        provider: 'AI Service',
        model: payload.modelId,
      },
      bulkOrganizeResult: result,
    };

    notifyPopup('CHAT_RESPONSE', response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to process your request.';
    throw new Error(errorMessage);
  }
};

const handleApplyChatAction = async (payload: ApplyChatActionPayload): Promise<void> => {
  if (!payload.result) {
    throw new Error('No organize result provided');
  }

  const result = payload.result;
  let appliedCount = 0;
  let skippedCount = 0;

  // Get current pathToIdMap from bookmark tree
  const tree = await chrome.bookmarks.getTree();
  const idToPathMap = buildFullIdToPathMapFromTree(tree);
  const pathToIdMap: Record<string, string> = {};
  Object.entries(idToPathMap).forEach(([id, path]) => {
    pathToIdMap[path] = id;
  });

  // Apply each approved assignment
  for (const assignment of result.assignments) {
    if (!assignment.isApproved) {
      skippedCount++;
      continue;
    }

    try {
      let targetFolderId = assignment.suggestedFolderId;

      // If folder doesn't exist (new folder), create it
      if (!targetFolderId) {
        targetFolderId = await createFolderPath(
          assignment.suggestedPath,
          pathToIdMap,
          '1' // Default to Bookmarks Bar
        );
      }

      // Move the bookmark
      await moveBookmark(assignment.bookmarkId, targetFolderId);
      appliedCount++;
    } catch (error) {
      console.error(`Failed to move bookmark ${assignment.bookmarkId}:`, error);
      skippedCount++;
    }
  }

  notifyPopup('CHAT_ACTION_COMPLETE', { appliedCount, skippedCount });
};

const persistError = async (errorMessage: string): Promise<void> => {
  const existingSession = await loadOrganizeSession() ?? getInitialSession();
  await saveOrganizeSession({
    ...existingSession,
    status: 'error',
    errorMessage,
  });
};

chrome.runtime.onMessage.addListener(
  (message: OrganizeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_ORGANIZE':
        handleStartOrganize(message.payload as StartOrganizePayload).catch(async error => {
          console.error('[Background] Error starting organize:', error);
          chrome.alarms.clear(KEEPALIVE_ALARM_NAME);

          const errorMessage = error instanceof Error ? error.message : 'Failed to organize bookmarks.';
          await persistError(errorMessage);
          notifyPopup('ORGANIZE_ERROR', { errorMessage });
        });
        sendResponse({ success: true });
        return true;

      case 'GET_ORGANIZE_STATUS':
        loadOrganizeSession().then(session => {
          sendResponse({ session });
        }).catch(error => {
          console.error('[Background] Error getting status:', error);
          sendResponse({ session: null });
        });
        return true;

      case 'CHAT_REQUEST':
        handleChatRequest(message.payload as ChatRequestPayload).catch(async error => {
          console.error('[Background] Chat Error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to process your request.';
          notifyPopup('CHAT_ACTION_ERROR', { errorMessage });
        });
        sendResponse({ success: true });
        return true;

      case 'APPLY_CHAT_ACTION':
        handleApplyChatAction(message.payload as ApplyChatActionPayload).catch(async error => {
          console.error('[Background] Apply Chat Action Error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to apply changes.';
          notifyPopup('CHAT_ACTION_ERROR', { errorMessage });
        });
        sendResponse({ success: true });
        return true;

      default:
        sendResponse({ success: true });
        return true;
    }
  }
);

chrome.alarms.onAlarm.addListener(() => {
  // Keepalive — prevents service worker from going idle during AI call
});
