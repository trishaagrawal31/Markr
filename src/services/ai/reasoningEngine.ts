import { type CompactBookmark } from '../../types/organize';

export interface IntentContext {
  pattern: 'sub-selection' | 'root-to-folder' | 'folder-to-folder' | 'tab-to-folder' | 'folder-operations' | 'general';
  criteria?: string[];
  targetFolder?: string;
  folderToDelete?: string;
  folderToUnpack?: string;
  folderOperation?: 'delete' | 'unpack';
}

const extractFolderName = (text: string): string | null => {
  // Try to extract folder name from patterns like:
  // "delete [the] [empty] FolderName [folder]"
  // "unpack [my] FolderName [folder]"

  const deletePatterns = [
    /delete\s+(?:the\s+)?(?:empty\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
    /remove\s+(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
    /trash\s+(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
    /get\s+rid\s+of\s+(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
  ];

  const unpackPatterns = [
    /unpack\s+(?:my\s+)?(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
    /flatten\s+(?:my\s+)?(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
    /merge\s+(?:my\s+)?(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
    /collapse\s+(?:my\s+)?(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
    /unwrap\s+(?:my\s+)?(?:the\s+)?(?:folder\s+)?([^.!?]+?)(?:\s+folder)?(?:[.!?]|\s|$)/i,
  ];

  const allPatterns = [...deletePatterns, ...unpackPatterns];
  for (const pattern of allPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // Fallback: if the user mentions 'unpack' plus a folder name anywhere, capture the last segment
  if (/\b(unpack|flatten|merge|collapse|unwrap)\b/i.test(text)) {
    const words = text
      .replace(/\b(unpack|flatten|merge|collapse|unwrap|folder|my|the|please|now)\b/gi, '')
      .replace(/[?!.]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length > 0) {
      return words.join(' ').trim();
    }
  }

  return null;
};

export const detectIntentPattern = (userIntent: string): IntentContext => {
  const lowerIntent = userIntent.toLowerCase();

  // Detect folder operations first (delete/unpack)
  if (lowerIntent.includes('delete') || (lowerIntent.includes('remove') && lowerIntent.includes('folder'))) {
    const folderName = extractFolderName(userIntent);
    return {
      pattern: 'folder-operations',
      folderToDelete: folderName || undefined,
      folderOperation: 'delete'
    };
  }
  if (lowerIntent.includes('unpack') || lowerIntent.includes('flatten') || lowerIntent.includes('collapse') || lowerIntent.includes('merge')) {
    const folderName = extractFolderName(userIntent);
    return {
      pattern: 'folder-operations',
      folderToUnpack: folderName || undefined,
      folderOperation: 'unpack'
    };
  }

  // Detect tab operations
  if (lowerIntent.includes('stash') ||
      (lowerIntent.includes('tab') && (lowerIntent.includes('save') || lowerIntent.includes('bookmark') || lowerIntent.includes('organize'))) ||
      (lowerIntent.includes('save') && lowerIntent.includes('tab')) ||
      (lowerIntent.includes('open') && (lowerIntent.includes('save') || lowerIntent.includes('bookmark'))) ||
      (lowerIntent.includes('organize') && lowerIntent.includes('tabs')) ||
      (lowerIntent.includes('save') && lowerIntent.includes('tabs')) ||
      (lowerIntent.includes('bookmark') && lowerIntent.includes('tabs')) ) {
    return { pattern: 'tab-to-folder' };
  }

  // Detect root to folder
  if (lowerIntent.includes('loose') || lowerIntent.includes('group') || lowerIntent.includes('organize root')) {
    return { pattern: 'root-to-folder' };
  }

  // Detect folder-to-folder moves
  if (lowerIntent.includes('from') && lowerIntent.includes('to')) {
    return { pattern: 'folder-to-folder' };
  }

  // Default to general
  return { pattern: 'general' };
};

export const buildIntentGuidance = (context: IntentContext, _bookmarks: CompactBookmark[]): string => {
  if (context.pattern === 'folder-operations') {
    if (context.folderOperation === 'delete') {
      const folder = context.folderToDelete ? `"${context.folderToDelete}"` : 'the specified folder';
      return `USER WANTS TO DELETE: ${folder}\n\nIMPORTANT: Return ONLY folderOperations, leave assignments empty. Find ${folder} in the folder structure and return it in folderOperations with operation: "delete"`;
    }
    if (context.folderOperation === 'unpack') {
      const folder = context.folderToUnpack ? `"${context.folderToUnpack}"` : 'the specified folder';
      return `USER WANTS TO UNPACK: ${folder}\n\nIMPORTANT: Return ONLY folderOperations, leave assignments empty. Find ${folder} in the folder structure and return it in folderOperations with operation: "unpack"`;
    }
  }

  if (context.pattern === 'tab-to-folder') {
    return `USER WANTS TO ORGANIZE OPEN TABS. Use only tab-* items from the Open Tabs list, and move them into the target folder structure. Return assignments for each matched tab item with a suggestedPath, and do not return folderOperations unless the user explicitly asks to delete or unpack a folder.`;
  }

  return '';
};

export const preFilterBookmarks = (bookmarks: CompactBookmark[], context: IntentContext): CompactBookmark[] => {
  // For folder operations, don't filter bookmarks - we're not moving any
  if (context.pattern === 'folder-operations') {
    return [];
  }
  return bookmarks;
};
