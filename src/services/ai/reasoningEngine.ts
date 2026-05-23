import { type CompactBookmark } from '../../types/organize';

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
 * Extracts the specific criteria the user is filtering by
 * E.g., "React", "design", "PDF", "tutorials"
 */
const extractCriteria = (userMessage: string): string[] => {
  const criteria: string[] = [];

  // Look for quoted phrases
  const quoted = userMessage.match(/"([^"]+)"/g);
  if (quoted) {
    criteria.push(...quoted.map(q => q.slice(1, -1)));
  }

  // Look for specific keywords
  const keywords = [
    'React', 'Vue', 'Angular', 'Python', 'Node', 'Go', 'Rust', 'Java',
    'Design', 'Figma', 'Dribbble', 'Adobe', 'Sketch',
    'PDF', 'Tutorial', 'Documentation', 'Article', 'Video',
    'Shopping', 'Tools', 'SaaS', 'API', 'GitHub', 'Stack Overflow',
    'CSS', 'HTML', 'JavaScript', 'TypeScript',
    'Database', 'SQL', 'MongoDB', 'PostgreSQL',
    'Productivity', 'Entertainment', 'Social', 'News', 'Reading'
  ];

  keywords.forEach(keyword => {
    if (userMessage.toLowerCase().includes(keyword.toLowerCase())) {
      criteria.push(keyword);
    }
  });

  return [...new Set(criteria)]; // Remove duplicates
};

/**
 * Analyzes user message to detect which granular transition pattern they're asking for
 */
export const detectIntentPattern = (userMessage: string): IntentContext => {
  const lower = userMessage.toLowerCase();
  const isTabOperation = lower.includes('tab') || lower.includes('open tab');
  const extractedCriteria = extractCriteria(userMessage);

  // SUB-SELECTION PATTERN: "Take just X out of Y" or "Extract X from Y" or "Move X from Y"
  const subSelectionMatch = userMessage.match(
    /(?:take|extract|move|get|pull|isolate|move only)\s+(?:just|only|specific|the)?\s*(.+?)\s+(?:out of|from|to|in)\s+(.+?)(?:\s+and|\s+folder|$)/i
  );
  if (subSelectionMatch) {
    const [, items, sourceFolder] = subSelectionMatch;
    const itemsText = items.trim();
    return {
      pattern: 'sub-selection',
      sourceFolder: sourceFolder.trim(),
      criteria: extractedCriteria.length > 0 ? extractedCriteria : [itemsText],
      isTabOperation,
      guidance: `SUB-SELECTION (STRICT FILTER): User wants to move ONLY "${itemsText}" from "${sourceFolder}".
        DO NOT move everything in that folder.
        MUST filter by: "${extractedCriteria.join(', ') || itemsText}"
        Include ONLY bookmarks matching this criteria.
        Leave ALL other items in source folder untouched.`,
    };
  }

  // Alternative sub-selection: "Move React files to React folder"
  const directSubSelection = userMessage.match(
    /(?:move|put|place)\s+(?:my\s+)?(?:all\s+)?(.+?)\s+(?:to|into|in)\s+(?:a\s+)?(?:new\s+)?(.+?)\s+folder/i
  );
  if (directSubSelection && !lower.includes('loose') && !lower.includes('unsorted')) {
    const [, items, destFolder] = directSubSelection;
    return {
      pattern: 'sub-selection',
      destinationFolder: destFolder.trim(),
      criteria: extractedCriteria.length > 0 ? extractedCriteria : [items.trim()],
      isTabOperation,
      guidance: `SUB-SELECTION (STRICT FILTER): User wants to move "${items.trim()}" to "${destFolder}".
        MUST filter strictly by: "${extractedCriteria.join(', ') || items.trim()}"
        DO NOT move unrelated items.
        Include ONLY exact matches.`,
    };
  }

  // ROOT-TO-FOLDER PATTERN: "Group loose bookmarks" or "Organize my unsorted bookmarks"
  if (lower.includes('loose') || lower.includes('unsorted') || lower.includes('organize') && lower.includes('bookmark')) {
    return {
      pattern: 'root-to-folder',
      isTabOperation,
      guidance: `ROOT-TO-FOLDER: User wants to organize scattered root-level bookmarks.
        Find ONLY bookmarks in "Bookmark Bar" or "Other Bookmarks" with no parent folder.
        Group by purpose/domain into category folders.
        DO NOT reorganize bookmarks already in folders.`,
    };
  }

  // FOLDER-TO-FOLDER PATTERN: "Move X from FolderA to FolderB"
  const folderMoveMatch = userMessage.match(
    /(?:move|transfer|relocate|place)\s+(?:all\s+)?(.+?)\s+(?:from|out of)\s+(.+?)\s+(?:to|into)\s+(.+?)(?:\s+folder)?$/i
  );
  if (folderMoveMatch) {
    const [, items, sourceFolder, destFolder] = folderMoveMatch;
    return {
      pattern: 'folder-to-folder',
      sourceFolder: sourceFolder.trim(),
      destinationFolder: destFolder.trim(),
      criteria: extractedCriteria.length > 0 ? extractedCriteria : [items.trim()],
      isTabOperation,
      guidance: `FOLDER-TO-FOLDER: User wants to move "${items.trim()}" from "${sourceFolder}" to "${destFolder}".
        MUST filter by criteria: "${extractedCriteria.join(', ') || items.trim()}"
        Move ONLY matched items; leave unrelated items in source.`,
    };
  }

  // TAB-TO-FOLDER PATTERN: "Stash these tabs" or "Save open tabs to folder"
  if (lower.includes('stash') || (lower.includes('save') && lower.includes('tab'))) {
    const folderMatch = userMessage.match(/(?:to|into|in)\s+(?:a\s+)?(?:new\s+)?(.+?)\s+folder/i);
    const destFolder = folderMatch ? folderMatch[1].trim() : undefined;
    return {
      pattern: 'tab-to-folder',
      destinationFolder: destFolder || 'Saved Tabs',
      criteria: extractedCriteria,
      isTabOperation: true,
      guidance: `TAB-TO-FOLDER STASHING: User wants to stash tabs to "${destFolder || 'Saved Tabs'}".
        Convert ONLY tabs matching criteria: "${extractedCriteria.join(', ') || 'any matching tabs'}"
        Leave unrelated tabs open.
        Close ONLY the stashed tabs.`,
    };
  }

  // DEFAULT: General organization request
  return {
    pattern: 'general',
    criteria: extractedCriteria,
    isTabOperation,
    guidance: extractedCriteria.length > 0
      ? `FILTERED ORGANIZATION: User mentioned ${extractedCriteria.join(', ')}.
        Focus on these items when organizing.`
      : `GENERAL ORGANIZATION: Analyze holistically and apply folder design rules.`,
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
