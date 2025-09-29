import type { PartialTree, PartialTreeId } from '@uppy/core'
import type { CompanionFile } from '@uppy/utils'
import addFolder from './addFolder.js'

interface EnsureAncestorChainResult {
  partialTree: PartialTree
  parentId: PartialTreeId | null
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch (_error) {
    return path
  }
}

function ensureAncestorChain(
  partialTree: PartialTree,
  folderPath: string,
  rootFolderId: PartialTreeId | null,
): EnsureAncestorChainResult {
  if (typeof folderPath !== 'string' || folderPath.length === 0) {
    return {
      partialTree,
      parentId: rootFolderId ?? null,
    }
  }

  const decodedPath = safeDecode(folderPath)
  const segments = decodedPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length <= 1) {
    return {
      partialTree,
      parentId: rootFolderId ?? null,
    }
  }

  const ancestors = segments.slice(0, -1)
  let nextPartialTree = partialTree
  let currentParentId = rootFolderId ?? null
  let currentPath = ''

  for (const segment of ancestors) {
    currentPath = `${currentPath}/${segment}`
    const encodedPath = encodeURIComponent(currentPath)

    const placeholderFolder = {
      isFolder: true,
      icon: 'folder',
      name: segment,
      id: encodedPath,
      requestPath: encodedPath,
    } as CompanionFile

    nextPartialTree = addFolder(nextPartialTree, placeholderFolder, {
      parentId: currentParentId,
      cached: false,
    })

    currentParentId = encodedPath as PartialTreeId
  }

  return {
    partialTree: nextPartialTree,
    parentId: currentParentId,
  }
}

export default ensureAncestorChain
