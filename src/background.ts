import { type OrganizeMessage, type StartOrganizePayload, type ChatRequestPayload } from './types/messaging';
import { type OrganizeSession } from './types/organize';
import { organizeBookmarks } from './services/ai/bulkOrganize';
import { saveOrganizeSession, loadOrganizeSession, getInitialSession } from './services/organizeSession';
import { type ActionPreviewData, type ChatResponsePayload, type ApplyChatActionPayload } from './types/chat';
import { moveBookmark, createFolderPath, getFullBookmarkLibrary, deleteFolder, unpacking, getBookmarkById, createBookmark } from './services/bookmarks';
import { buildFullIdToPathMapFromTree, findFolderIdByAIPath } from './utils/folders';
import { type BulkOrganizeResult } from './types/organize';
import { queryAI } from './services/ai';

const KEEPALIVE_ALARM_NAME = 'organize-keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.4;

// Store the last chat action result for applying changes
let lastChatActionResult: BulkOrganizeResult | null = null;

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

  const folderOperations = result.folderOperations
    ? result.folderOperations.map(op => ({
        folderId: '',
        folderPath: op.folderPath,
        operation: op.operation,
        description: op.description,
      }))
    : undefined;

  return {
    foldersToCreate,
    affectedBookmarks,
    folderOperations,
    summary: result.folderPlan.summary,
    canApprove: affectedBookmarks.length > 0 || (folderOperations?.length ?? 0) > 0,
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

const isOrganizationRequest = (message: string): boolean => {
  const lowerMsg = message.toLowerCase();
  const organizationKeywords = [
    'organize', 'move', 'sort', 'arrange', 'rearrange', 'reorganize',
    'clean', 'group', 'categorize', 'folder', 'bookmark',
    'save tab', 'bookmark tab', 'tab', 'save these',
    'structure', 'order', 'sort out'
  ];

  const chatKeywords = ['what', 'how', 'why', 'help', 'can you', 'could you', 'tell me', 'explain', 'hello', 'hi', 'hey', 'good'];

  // If message contains clear chat keywords and no organization keywords, it's a chat question
  const hasChat = chatKeywords.some(kw => lowerMsg.includes(kw));
  const hasOrganize = organizationKeywords.some(kw => lowerMsg.includes(kw));

  // Only treat as organization request if it explicitly has organization keywords
  // Otherwise, default to chat response for unknown messages
  return hasOrganize && !hasChat;
};

const handleChatRequest = async (payload: ChatRequestPayload): Promise<void> => {
  try {
    // Check if this is a chat question or an organization request
    if (!isOrganizationRequest(payload.message)) {
      // This is a general chat question - get dynamic AI response
      const aiResponse = await queryAI(
        payload.serviceId,
        payload.modelId,
        payload.message,
        payload.maxOutputTokens
      );

      const response: ChatResponsePayload = {
        message: aiResponse,
        modelUsed: {
          provider: 'AI Service',
          model: payload.modelId,
        },
      };

      notifyPopup('CHAT_RESPONSE', response);
      return;
    }

    // Get comprehensive bookmark context (not just open tabs)
    const tree = await chrome.bookmarks.getTree();

    // Get ALL bookmarks in the library
    const allBookmarks = await getFullBookmarkLibrary();

    // Also get open tabs for context - query ALL windows, not just current
    const tabs = await chrome.tabs.query({});
    const openTabBookmarks = tabs
      .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'))
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

    const bookmarksToAnalyze = includeOpenTabsOnly ? openTabBookmarks : [...allBookmarks, ...openTabBookmarks];

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

    // Store result for later application
    lastChatActionResult = result;

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
    let errorMessage = 'Failed to process your request.';

    if (error instanceof Error) {
      const errMsg = error.message.toLowerCase();

      // Handle rate limit errors
      if (errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('high demand')) {
        errorMessage = '⏳ API Overload: The AI service is experiencing high demand. Please try again in a moment.';
      }
      // Handle quota exceeded
      else if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate limit')) {
        errorMessage = '⛔ Rate Limited: Too many requests. Please wait a few moments before trying again.';
      }
      // Handle authentication errors
      else if (errMsg.includes('401') || errMsg.includes('unauthorized') || errMsg.includes('invalid api key')) {
        errorMessage = '🔑 Authentication Error: Your API key is invalid or expired. Check your settings.';
      }
      // Handle invalid request
      else if (errMsg.includes('400') || errMsg.includes('bad request')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      }
      // Generic API errors
      else if (errMsg.includes('api') || errMsg.includes('error')) {
        errorMessage = `⚠️ API Error: ${error.message}`;
      }
      // Use original message if it's helpful
      else if (error.message.length < 200) {
        errorMessage = error.message;
      }
    }

    notifyPopup('CHAT_ACTION_ERROR', { errorMessage });
  }
};

const handleApplyChatAction = async (payload: ApplyChatActionPayload): Promise<void> => {
  if (!payload.actionPreview || !lastChatActionResult) {
    throw new Error('No action preview or result data available');
  }

  const { actionPreview } = payload;
  let appliedCount = 0;
  let skippedCount = 0;

  try {
    // Get current tree and build fresh maps
    const tree = await chrome.bookmarks.getTree();
    const idToPathMap = buildFullIdToPathMapFromTree(tree);

    // Build reverse map: path -> ID
    const pathToIdMap: Record<string, string> = {};
    Object.entries(idToPathMap).forEach(([id, path]) => {
      pathToIdMap[path] = id;
    });

    console.log('[ApplyAction] Starting apply action');
    console.log('[ApplyAction] Total folders in tree:', Object.keys(idToPathMap).length);

    // Step 1: Create any new folders that are needed
    const foldersToCreate = actionPreview.foldersToCreate || [];
    console.log('[ApplyAction] Folders to create:', foldersToCreate.length);

    for (const folder of foldersToCreate) {
      try {
        // Check if folder already exists (try different path variations)
        const existingId = findFolderIdByAIPath(folder.path, pathToIdMap);

        if (existingId) {
          console.log(`[ApplyAction] Folder already exists: ${folder.path} (ID: ${existingId})`);
          continue;
        }

        console.log(`[ApplyAction] Creating folder: ${folder.path}`);
        const folderId = await createFolderPath(
          folder.path,
          pathToIdMap,
          undefined // Use default: "Other Bookmarks" (id: 2)
        );
        console.log(`[ApplyAction] Created folder: ${folder.path} with ID: ${folderId}`);
      } catch (error) {
        console.error(`[ApplyAction] Failed to create folder ${folder.path}:`, error);
      }
    }

    // Refresh tree after folder creation
    const updatedTree = await chrome.bookmarks.getTree();
    const updatedIdToPathMap = buildFullIdToPathMapFromTree(updatedTree);
    const updatedPathToIdMap: Record<string, string> = {};
    Object.entries(updatedIdToPathMap).forEach(([id, path]) => {
      updatedPathToIdMap[path] = id;
    });

    console.log('[ApplyAction] Total folders after creation:', Object.keys(updatedIdToPathMap).length);

    // Step 2: Apply folder operations (delete/unpack) before moving bookmarks
    const folderOperations = actionPreview.folderOperations || [];
    console.log('[ApplyAction] Folder operations to apply:', folderOperations.length);

    for (const op of folderOperations) {
      try {
        const folderId = findFolderIdByAIPath(op.folderPath, updatedPathToIdMap);
        if (!folderId) {
          console.log(`[ApplyAction] Folder not found: ${op.folderPath}`);
          continue;
        }

        if (op.operation === 'delete') {
          console.log(`[ApplyAction] Deleting folder: ${op.folderPath}`);
          await deleteFolder(folderId);
          console.log(`[ApplyAction] ✓ Successfully deleted: ${op.folderPath}`);
        } else if (op.operation === 'unpack') {
          console.log(`[ApplyAction] Unpacking folder: ${op.folderPath}`);
          // Get the parent ID
          const folder = await getBookmarkById(folderId);
          if (!folder?.parentId) {
            throw new Error(`Could not find parent for folder: ${op.folderPath}`);
          }
          await unpacking(folderId, folder.parentId);
          console.log(`[ApplyAction] ✓ Successfully unpacked: ${op.folderPath}`);
        }
      } catch (error) {
        console.error(`[ApplyAction] Failed to ${op.operation} folder ${op.folderPath}:`, error);
      }
    }

    // Refresh tree after folder operations
    if (folderOperations.length > 0) {
      const refreshedTree = await chrome.bookmarks.getTree();
      const refreshedIdToPathMap = buildFullIdToPathMapFromTree(refreshedTree);
      const refreshedPathToIdMap: Record<string, string> = {};
      Object.entries(refreshedIdToPathMap).forEach(([id, path]) => {
        refreshedPathToIdMap[path] = id;
      });
      // Update the maps for bookmark moves
      Object.assign(updatedIdToPathMap, refreshedIdToPathMap);
      Object.assign(updatedPathToIdMap, refreshedPathToIdMap);
    }

    // Step 3: Apply each bookmark move from the stored result
    const affectedBookmarks = actionPreview.affectedBookmarks || [];
    console.log('[ApplyAction] Bookmarks to move:', affectedBookmarks.length);

    for (const bookmark of affectedBookmarks) {
      try {
        // Handle tabs differently - bookmark them instead of moving
        if (bookmark.id.startsWith('tab-')) {
          console.log(`[ApplyAction] Bookmarking tab: "${bookmark.title}" to "${bookmark.suggestedPath}"`);

          // Extract tab ID from 'tab-{id}' format
          const tabId = parseInt(bookmark.id.replace('tab-', ''), 10);

          // Resolve the target folder ID
          let targetFolderId = findFolderIdByAIPath(bookmark.suggestedPath, updatedPathToIdMap);

          if (!targetFolderId) {
            console.log(`[ApplyAction] Path not found in map, attempting to create: ${bookmark.suggestedPath}`);
            targetFolderId = await createFolderPath(
              bookmark.suggestedPath,
              updatedPathToIdMap,
              undefined
            );
            console.log(`[ApplyAction] Created and got folder ID: ${targetFolderId}`);
          }

          if (!targetFolderId) {
            throw new Error(`Could not resolve folder ID for path: ${bookmark.suggestedPath}`);
          }

          // Get tab details
          const tab = await chrome.tabs.get(tabId).catch(() => null);
          if (tab && tab.url) {
            // Create bookmark from tab
            await createBookmark(targetFolderId, bookmark.title, tab.url);
            console.log(`[ApplyAction] ✓ Successfully bookmarked tab: ${bookmark.title}`);
            appliedCount++;
          } else {
            console.warn(`[ApplyAction] Tab ${tabId} not found or has no URL`);
            skippedCount++;
          }
          continue;
        }

        console.log(`[ApplyAction] Moving bookmark: "${bookmark.title}" from "${bookmark.currentPath}" to "${bookmark.suggestedPath}"`);

        // Resolve the target folder ID
        let targetFolderId = findFolderIdByAIPath(bookmark.suggestedPath, updatedPathToIdMap);

        if (!targetFolderId) {
          console.log(`[ApplyAction] Path not found in map, attempting to create: ${bookmark.suggestedPath}`);
          // Try to create the folder path if it doesn't exist
          targetFolderId = await createFolderPath(
            bookmark.suggestedPath,
            updatedPathToIdMap,
            undefined
          );
          console.log(`[ApplyAction] Created and got folder ID: ${targetFolderId}`);
        } else {
          console.log(`[ApplyAction] Resolved path to folder ID: ${targetFolderId}`);
        }

        if (!targetFolderId) {
          throw new Error(`Could not resolve folder ID for path: ${bookmark.suggestedPath}`);
        }

        // Move the bookmark
        console.log(`[ApplyAction] Executing move: bookmark ${bookmark.id} → folder ${targetFolderId}`);
        await moveBookmark(bookmark.id, targetFolderId);
        console.log(`[ApplyAction] ✓ Successfully moved: ${bookmark.title}`);
        appliedCount++;
      } catch (error) {
        console.error(`[ApplyAction] ✗ Failed to process "${bookmark.title}":`, error);
        skippedCount++;
      }
    }

    // Clear stored result after applying
    lastChatActionResult = null;

    console.log(`[ApplyAction] ✓ Complete: ${appliedCount} applied, ${skippedCount} skipped`);
    notifyPopup('CHAT_ACTION_COMPLETE', { appliedCount, skippedCount });
  } catch (error) {
    console.error('[ApplyAction] Critical error:', error);

    let errorMessage = 'Failed to apply changes.';
    if (error instanceof Error) {
      const errMsg = error.message.toLowerCase();

      if (errMsg.includes('permission') || errMsg.includes('denied')) {
        errorMessage = '🔒 Permission Denied: The extension lacks permission to modify bookmarks. Please check permissions.';
      } else if (errMsg.includes('quota')) {
        errorMessage = '📊 Chrome Storage Quota Exceeded: Too many bookmarks. Try organizing into fewer folders.';
      } else if (error.message.length < 200) {
        errorMessage = error.message;
      }
    }

    notifyPopup('CHAT_ACTION_ERROR', { errorMessage });
  }
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
