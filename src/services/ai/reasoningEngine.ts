import { type CompactBookmark } from '../../types/organize';
import { type FolderPathMap } from '../../types/bookmarks';

/**
 * Markr Reasoning Engine - Interprets user intent and provides context for AI bookmark orchestration
 * Detects the four granular transition patterns and enriches the AI prompt with precise guidance
 */

export interface IntentContext {
  pattern: 'sub-selection' | 'root-to-folder' | 'folder-to-folder' | 'tab-to-folder' | 'general';
  sourceFolder?: string;
  destinationFolder?: string;
  criteria?: string[];
  isTabOperation: boolean;
  guidance: string;
}

/**
 * Analyzes user message to detect which granular transition pattern they're asking for
 */
export const detectIntentPattern = (userMessage: string): IntentContext => {
  const lower = userMessage.toLowerCase();
  const isTabOperation = lower.includes('tab') || lower.includes('open tab');

  // SUB-SELECTION PATTERN: "Take just X out of Y" or "Extract X from Y"
  const subSelectionMatch = userMessage.match(
    /(?:take|extract|move|get|pull|isolate)\s+(?:just|only|specific)\s+(.+?)\s+(?:out of|from)\s+(.+?)(?:\s+and|\s+to|$)/i
  );
  if (subSelectionMatch) {
    const [, items, sourceFolder] = subSelectionMatch;
    return {
      pattern: 'sub-selection',
      sourceFolder: sourceFolder.trim(),
      criteria: [items.trim()],
      isTabOperation,
      guidance: `SUB-SELECTION: User wants to extract ONLY certain bookmarks from "${sourceFolder}".
        Do NOT move everything in that folder — identify only the items matching "${items}" and leave others untouched.
        Be surgical: match by title keywords, URL patterns, or semantic categories.`,
    };
  }

  // ROOT-TO-FOLDER PATTERN: "Group loose bookmarks" or "Organize my unsorted bookmarks"
  if (lower.includes('loose') || lower.includes('unsorted') || lower.includes('root') || lower.includes('bar')) {
    return {
      pattern: 'root-to-folder',
      isTabOperation,
      guidance: `ROOT-TO-FOLDER: User wants to organize bookmarks currently floating on the Bookmark Bar or root level.
        Identify bookmarks that have currentFolderPath of "Bookmark Bar", "Other Bookmarks", or similar root locations.
        Group them into context-specific folders based on their URLs and titles.`,
    };
  }

  // FOLDER-TO-FOLDER PATTERN: "Move X from FolderA to FolderB"
  const folderMoveMatch = userMessage.match(
    /(?:move|transfer|relocate|place)\s+(.+?)\s+(?:from|out of)\s+(.+?)\s+(?:to|into)\s+(.+?)(?:\s+folder)?$/i
  );
  if (folderMoveMatch) {
    const [, items, sourceFolder, destFolder] = folderMoveMatch;
    return {
      pattern: 'folder-to-folder',
      sourceFolder: sourceFolder.trim(),
      destinationFolder: destFolder.trim(),
      criteria: [items.trim()],
      isTabOperation,
      guidance: `FOLDER-TO-FOLDER: User wants to move specific bookmarks from "${sourceFolder}" to "${destFolder}".
        Find bookmarks currently in "${sourceFolder}" that match "${items}" criteria.
        Move ONLY matched items; leave unrelated bookmarks in their source folder.`,
    };
  }

  // TAB-TO-FOLDER PATTERN: "Stash these tabs" or "Save open tabs to folder"
  if (lower.includes('stash') || lower.includes('save') || (lower.includes('tab') && lower.includes('folder'))) {
    const folderMatch = userMessage.match(/(?:to|into|in)\s+(?:a\s+)?(?:new\s+)?(.+?)\s+folder/i);
    const destFolder = folderMatch ? folderMatch[1].trim() : undefined;
    return {
      pattern: 'tab-to-folder',
      destinationFolder: destFolder || 'Saved Tabs',
      isTabOperation: true,
      guidance: `TAB-TO-FOLDER STASHING: User wants to convert specific open tabs into bookmarks in "${destFolder || 'Saved Tabs'}".
        Only move tabs that match the user's criteria — leave unrelated open tabs alone.
        Close the stashed tabs after moving them.`,
    };
  }

  // DEFAULT: General organization request
  return {
    pattern: 'general',
    isTabOperation,
    guidance: `GENERAL ORGANIZATION: User is asking for general bookmark reorganization.
      Analyze their intent holistically and apply folder design rules to improve their structure.`,
  };
};

/**
 * Builds enhanced system prompt addition that guides the AI based on detected intent
 */
export const buildIntentGuidance = (context: IntentContext, bookmarks: CompactBookmark[]): string => {
  const tabBookmarks = bookmarks.filter(b => b.id.startsWith('tab-'));
  const regularBookmarks = bookmarks.filter(b => !b.id.startsWith('tab-'));

  let guidance = `=== DETECTED INTENT: ${context.pattern.toUpperCase()} ===\n${context.guidance}\n\n`;

  if (context.pattern === 'sub-selection' && context.sourceFolder) {
    const sourceBookmarks = regularBookmarks.filter(b => b.currentFolderPath.includes(context.sourceFolder!));
    guidance += `BOOKMARKS IN "${context.sourceFolder}": ${sourceBookmarks.length} items\n`;
    guidance += `Only analyze these when filtering by "${context.criteria?.join(', ')}"\n`;
  }

  if (context.pattern === 'root-to-folder') {
    const rootBookmarks = regularBookmarks.filter(
      b => b.currentFolderPath === 'Bookmark Bar' || b.currentFolderPath === 'Other Bookmarks' || b.currentFolderPath === 'Root'
    );
    guidance += `ROOT-LEVEL BOOKMARKS: ${rootBookmarks.length} items to organize\n`;
    guidance += `Categorize by domain and purpose. Create folders as needed.\n`;
  }

  if (context.pattern === 'folder-to-folder') {
    const sourceBookmarks = regularBookmarks.filter(b => b.currentFolderPath.includes(context.sourceFolder!));
    guidance += `SOURCE FOLDER "${context.sourceFolder}": ${sourceBookmarks.length} items\n`;
    guidance += `DESTINATION: "${context.destinationFolder}"\n`;
    guidance += `Move ONLY items matching "${context.criteria?.join(', ')}" — leave others untouched\n`;
  }

  if (context.pattern === 'tab-to-folder') {
    guidance += `OPEN TABS TO STASH: ${tabBookmarks.length} tabs available\n`;
    guidance += `DESTINATION FOLDER: "${context.destinationFolder}"\n`;
    guidance += `Create this folder if needed. Convert matched tabs to bookmarks and mark for closing.\n`;
  }

  return guidance;
};

/**
 * Filters bookmarks to those likely matching user's intent (pre-AI filtering)
 * This helps the AI focus on relevant items
 */
export const preFilterBookmarks = (
  bookmarks: CompactBookmark[],
  context: IntentContext
): CompactBookmark[] => {
  if (context.pattern === 'sub-selection' && context.sourceFolder && context.criteria) {
    // Only include bookmarks from the source folder
    return bookmarks.filter(b => b.currentFolderPath.includes(context.sourceFolder!));
  }

  if (context.pattern === 'root-to-folder') {
    // Only include root-level bookmarks
    return bookmarks.filter(
      b => b.currentFolderPath === 'Bookmark Bar' || b.currentFolderPath === 'Other Bookmarks' || b.currentFolderPath === 'Root'
    );
  }

  if (context.pattern === 'folder-to-folder' && context.sourceFolder) {
    // Include both source and destination context
    return bookmarks.filter(
      b => b.currentFolderPath.includes(context.sourceFolder!) || b.currentFolderPath === context.destinationFolder
    );
  }

  if (context.pattern === 'tab-to-folder') {
    // Prioritize tabs, include destination folder context
    const tabs = bookmarks.filter(b => b.id.startsWith('tab-'));
    const destContext = bookmarks.filter(b => b.currentFolderPath.includes(context.destinationFolder || ''));
    return [...tabs, ...destContext];
  }

  // General: include all
  return bookmarks;
};
