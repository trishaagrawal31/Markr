import { type ChromeBookmarkNode, type FolderPathMap } from '../types/bookmarks';
import { type CompactBookmark } from '../types/organize';
import { flattenAllBookmarks } from '../utils/bookmarkScanner';

export const getBookmarkTree = async (): Promise<ChromeBookmarkNode[]> => {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((tree) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tree as ChromeBookmarkNode[]);
    });
  });
};

export const getBookmarkById = async (id: string): Promise<ChromeBookmarkNode | null> => {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.get(id, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(results.length > 0 ? (results[0] as ChromeBookmarkNode) : null);
    });
  });
};

export const findBookmarkByUrl = async (url: string): Promise<ChromeBookmarkNode | null> => {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.search({ url }, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(results.length > 0 ? (results[0] as ChromeBookmarkNode) : null);
    });
  });
};

export const createFolder = async (
  parentId: string,
  title: string
): Promise<ChromeBookmarkNode> => {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create({ parentId, title }, (folder) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(folder as ChromeBookmarkNode);
    });
  });
};

export const createBookmark = async (
  parentId: string,
  title: string,
  url: string
): Promise<ChromeBookmarkNode> => {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create({ parentId, title, url }, (bookmark) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(bookmark as ChromeBookmarkNode);
    });
  });
};

export const moveBookmark = async (
  bookmarkId: string,
  destinationFolderId: string
): Promise<ChromeBookmarkNode> => {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.move(bookmarkId, { parentId: destinationFolderId }, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result as ChromeBookmarkNode);
    });
  });
};

export const createFolderPath = async (
  folderPath: string,
  pathToIdMap: FolderPathMap,
  defaultParentId: string
): Promise<string> => {
  const segments = folderPath.split('/');
  let currentParentId = defaultParentId;
  let resolvedPath = '';

  for (const segment of segments) {
    resolvedPath = resolvedPath ? `${resolvedPath}/${segment}` : segment;

    if (pathToIdMap[resolvedPath]) {
      currentParentId = pathToIdMap[resolvedPath];
      continue;
    }

    // AI sometimes omits root segments (e.g. "Utilities" instead of "Bookmarks Bar/Utilities")
    // Only resolve when the match is unambiguous — avoids misfiling when multiple folders share a name
    const suffixMatches = Object.entries(pathToIdMap).filter(
      ([key]) => key.endsWith(`/${resolvedPath}`)
    );

    if (suffixMatches.length === 1) {
      currentParentId = suffixMatches[0][1];
      resolvedPath = suffixMatches[0][0];
      continue;
    }

    const newFolder = await createFolder(currentParentId, segment);
    currentParentId = newFolder.id;
    pathToIdMap[resolvedPath] = newFolder.id;
  }

  return currentParentId;
};

// Get all bookmarks in the library (not just open tabs)
export const getFullBookmarkLibrary = async (
  idToPathMap?: Record<string, string>
): Promise<CompactBookmark[]> => {
  const tree = await getBookmarkTree();
  const pathMap = idToPathMap || buildIdToPathMap(tree);
  return flattenAllBookmarks(tree, pathMap);
};

// Build ID to path mapping from tree
const buildIdToPathMap = (tree: ChromeBookmarkNode[]): Record<string, string> => {
  const map: Record<string, string> = {};

  const traverse = (node: ChromeBookmarkNode, path: string) => {
    if (node.id) {
      map[node.id] = path || 'Root';
    }
    if (node.children) {
      node.children.forEach(child => {
        const childPath = path ? `${path}/${child.title || 'Unnamed'}` : (child.title || 'Unnamed');
        traverse(child, childPath);
      });
    }
  };

  tree.forEach(node => {
    traverse(node, node.title || 'Root');
  });

  return map;
};
