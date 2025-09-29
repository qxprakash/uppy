import type { PartialTree, PartialTreeId } from '@uppy/core'
import type { CompanionFile } from '@uppy/utils'

interface AddFolderOptions {
  parentId?: PartialTreeId | null
  cached?: boolean
}

function resolveParentId(
  folder: CompanionFile,
  explicitParentId?: PartialTreeId | null,
): PartialTreeId | null {
  if (explicitParentId !== undefined) {
    return explicitParentId ?? null
  }

  const parentFromData = (folder as any).parent ?? (folder as any).parentId
  if (typeof parentFromData === 'string') {
    return parentFromData
  }

  const requestPath = folder.requestPath ?? ''
  if (typeof requestPath === 'string' && requestPath.length > 0) {
    const lastSlashIndex = requestPath.lastIndexOf('/')
    if (lastSlashIndex > 0) {
      return requestPath.slice(0, lastSlashIndex) as PartialTreeId
    }
  }

  return null
}

function addFolder(
  partialTree: PartialTree,
  folder: CompanionFile,
  options: AddFolderOptions = {},
): PartialTree {
  const folderId = (folder.requestPath ?? folder.id) as PartialTreeId | undefined
  if (!folderId) {
    return partialTree
  }

  const resolvedParentId = resolveParentId(folder, options.parentId)
  const cachedFlag = options.cached ?? Boolean((folder as any).cached ?? false)
  const nextPagePath = (folder as any).nextPagePath ?? null
  const status = (folder as any).status ?? 'unchecked'

  const newPartialTree = [...partialTree]
  const existingIndex = newPartialTree.findIndex((item) => item.id === folderId)

  const nextEntry = {
    type: 'folder' as const,
    id: folderId,
    parentId: resolvedParentId,
    cached: cachedFlag,
    nextPagePath,
    status: status as 'unchecked' | 'checked',
    data: folder,
  }

  if (existingIndex === -1) {
    newPartialTree.push(nextEntry)
  } else {
    const existing = newPartialTree[existingIndex]
    if (existing.type === 'folder') {
      newPartialTree[existingIndex] = {
        ...existing,
        ...nextEntry,
        cached: existing.cached || nextEntry.cached,
        nextPagePath: existing.nextPagePath ?? nextEntry.nextPagePath,
        status: existing.status ?? nextEntry.status,
      }
    } else if (existing.type === 'root') {
      return newPartialTree
    }
  }

  return newPartialTree
}

export default addFolder
