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
    // Popup might be closed â€” this is expected
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

const isTransientError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('503') || msg.includes('unavailable') || msg.includes('high demand') ||
    msg.includes('429') || msg.includes('rate limit') || msg.includes('temporarily');
};

const retryWithBackoff = async <T,>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  initialDelayMs: number = 1000
): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      lastError = error;

      // Only retry on transient errors
      if (!isTransientError(error) || attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      console.log(`[Organize] Transient error, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`, error.message);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('Unknown error');
};

const handleStartOrganize = async (payload: StartOrganizePayload): Promise<void> => {
  chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
  });

  try {
    const result = await retryWithBackoff(() =>
      organizeBookmarks(
        payload.serviceId,
        payload.modelId,
        payload.bookmarks,
        payload.folderTree,
        payload.pathToIdMap,
        payload.maxOutputTokens,
        payload.userInstructions
      )
    );

    // Merge AI results into the existing session (or a fresh one if storage read fails)
    const existingSession = await loadOrganizeSession() ?? getInitialSession();

    // User may have cancelled while the AI call was in flight â€” do not overwrite
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
  } catch (error) {
    chrome.alarms.clear(KEEPALIVE_ALARM_NAME);

    let errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
    if (error instanceof Error) {
      const errMsg = error.message.toLowerCase();

      if (errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('high demand')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      } else if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate limit')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      } else if (errMsg.includes('401') || errMsg.includes('unauthorized') || errMsg.includes('invalid api key')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      } else if (errMsg.includes('timed out')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      } else if (errMsg.includes('network') || errMsg.includes('failed to fetch')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      } else if (error.message.length < 200) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      }
    }

    await persistError(errorMessage);
    notifyPopup('ORGANIZE_ERROR', { errorMessage });
    throw error;
  }
};

const getMarkrContextResponse = (message: string): string | null => {
  const normalizedMessage = message.trim().toLowerCase();
  const markrIdentityPatterns = [
    /\bwho\s+(is|are)\s+(markr|you|it|this)\b/i,
    /\bwhat\s+(is|does|can)\s+(markr|this|it|you)\b/i,
    /\bwhat\s+does\s+(it|this)\s+do\b/i,
    /\bwhat\s+does\s+markr\s+do\b/i,
    /\bwhat\s+can\s+markr\s+do\b/i,
    /\bwho\s+is\s+markr\b/i,
    /\bwhat\s+is\s+this\s+(app|extension)\b/i,
    /\bwhat\s+does\s+this\s+(app|extension)\s+do\b/i,
  ];

  const isMarkrQuestion = markrIdentityPatterns.some(pattern => pattern.test(message));

  if (!isMarkrQuestion) {
    return null;
  }

  return [
    'Markr is an AI-powered bookmark manager for your browser.',
    'It helps you save, organize, and find bookmarks by understanding your library and suggesting the right folders.',
    'You can ask it to sort bookmarks, create or clean up folders, move items, handle folder operations, and even organize your open tabs.',
  ].join(' ');
};

const isOrganizationRequest = (message: string): boolean => {
  const lowerMsg = message.toLowerCase();
  const organizationKeywords = [
    'organize', 'move', 'sort', 'arrange', 'rearrange', 'reorganize',
    'clean', 'group', 'categorize', 'folder', 'bookmark',
    'save tab', 'bookmark tab', 'tab', 'save these',
    'structure', 'order', 'sort out'
  ];

  const hasOrganize = organizationKeywords.some(kw => lowerMsg.includes(kw));

  // If message contains organization keywords, treat as organization request
  // regardless of chat keywords. For example: "how do I organize X?" should be treated as organization
  return hasOrganize;
};

const handleChatRequest = async (payload: ChatRequestPayload): Promise<void> => {
  try {
    const markrResponse = getMarkrContextResponse(payload.message);
    if (markrResponse) {
      const response: ChatResponsePayload = {
        message: markrResponse,
        modelUsed: {
          provider: 'AI Service',
          model: payload.modelId,
        },
      };

      notifyPopup('CHAT_RESPONSE', response);
      return;
    }

    // Check if this is a chat question or an organization request
    if (!isOrganizationRequest(payload.message)) {
      // This is a general chat question - get dynamic AI response with bookmark context
      let contextMessage = payload.message;

      // Add bookmark context from the payload if available
      if (payload.folderTree || Object.keys(payload.pathToIdMap).length > 0) {
        contextMessage = `User's bookmark library context:\n\nFolders: ${Object.keys(payload.pathToIdMap).join(', ') || 'No folders'}\n\nUser question: ${payload.message}`;
      }

      const aiResponse = await retryWithBackoff(() =>
        queryAI(
          payload.serviceId,
          payload.modelId,
          contextMessage,
          payload.maxOutputTokens
        )
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
    } catch {
      // Ignore tree serialization errors
    }

    // If the user explicitly mentions "open tabs", focus on those
    // Otherwise, search through entire bookmark library + open tabs
    const includeOpenTabsOnly =
      payload.message.toLowerCase().includes('open') &&
      payload.message.toLowerCase().includes('tabs');

    const bookmarksToAnalyze = includeOpenTabsOnly ? openTabBookmarks : [...allBookmarks, ...openTabBookmarks];

    // Call AI with the comprehensive context and automatic retry on transient errors
    const result = await retryWithBackoff(() =>
      organizeBookmarks(
        payload.serviceId,
        payload.modelId,
        bookmarksToAnalyze,
        folderTree,
        pathToIdMap,
        payload.maxOutputTokens,
        payload.message
      )
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
    let errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';

    if (error instanceof Error) {
      const errMsg = error.message.toLowerCase();

      // Handle rate limit errors
      if (errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('high demand')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      }
      // Handle quota exceeded
      else if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate limit')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      }
      // Handle authentication errors
      else if (errMsg.includes('401') || errMsg.includes('unauthorized') || errMsg.includes('invalid api key')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      }
      // Handle invalid request
      else if (errMsg.includes('400') || errMsg.includes('bad request')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      }
      // Generic API errors
      else if (errMsg.includes('api') || errMsg.includes('error')) {
        errorMessage = `âš ï¸ API Error: ${error.message}`;
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
          console.log(`[ApplyAction] âœ“ Successfully deleted: ${op.folderPath}`);
        } else if (op.operation === 'unpack') {
          console.log(`[ApplyAction] Unpacking folder: ${op.folderPath}`);
          // Get the parent ID
          const folder = await getBookmarkById(folderId);
          if (!folder?.parentId) {
            throw new Error(`Could not find parent for folder: ${op.folderPath}`);
          }
          await unpacking(folderId, folder.parentId);
          console.log(`[ApplyAction] âœ“ Successfully unpacked: ${op.folderPath}`);
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
            console.log(`[ApplyAction] âœ“ Successfully bookmarked tab: ${bookmark.title}`);
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
        console.log(`[ApplyAction] Executing move: bookmark ${bookmark.id} â†’ folder ${targetFolderId}`);
        await moveBookmark(bookmark.id, targetFolderId);
        console.log(`[ApplyAction] âœ“ Successfully moved: ${bookmark.title}`);
        appliedCount++;
      } catch (error) {
        console.error(`[ApplyAction] âœ— Failed to process "${bookmark.title}":`, error);
        skippedCount++;
      }
    }

    // Clear stored result after applying
    lastChatActionResult = null;

    console.log(`[ApplyAction] âœ“ Complete: ${appliedCount} applied, ${skippedCount} skipped`);
    notifyPopup('CHAT_ACTION_COMPLETE', { appliedCount, skippedCount });
  } catch (error) {
    console.error('[ApplyAction] Critical error:', error);

    let errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
    if (error instanceof Error) {
      const errMsg = error.message.toLowerCase();

      if (errMsg.includes('permission') || errMsg.includes('denied')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
      } else if (errMsg.includes('quota')) {
        errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
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

          let errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
          if (error instanceof Error) {
            const errMsg = error.message.toLowerCase();
            if (errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('high demand')) {
              errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
            } else if (errMsg.includes('429') || errMsg.includes('rate limit')) {
              errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
            } else if (errMsg.includes('401') || errMsg.includes('unauthorized')) {
              errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
            } else if (error.message.length < 200) {
              errorMessage = error.message;
            }
          }

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
          let errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
          if (error instanceof Error) {
            const errMsg = error.message.toLowerCase();
            if (errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('high demand')) {
              errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
            } else if (errMsg.includes('429') || errMsg.includes('rate limit')) {
              errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
            } else if (errMsg.includes('401') || errMsg.includes('unauthorized')) {
              errorMessage = '❌ Invalid Request: The request was malformed. Please try rephrasing your command.';
            } else if (error.message.length < 200) {
              errorMessage = error.message;
            }
          }
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
  // Keepalive â€” prevents service worker from going idle during AI call
});

