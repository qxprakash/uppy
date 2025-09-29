import type {
  PartialTree,
  PartialTreeFile,
  PartialTreeFolder,
  PartialTreeFolderNode,
} from '@uppy/core'
import type { CompanionFile } from '@uppy/utils'

const afterOpenFolder = (
  oldPartialTree: PartialTree,
  discoveredItems: CompanionFile[],
  clickedFolder: PartialTreeFolder,
  currentPagePath: string | null,
  validateSingleFile: (file: CompanionFile) => string | null,
): PartialTree => {
  const discoveredFolders = discoveredItems.filter((i) => i.isFolder === true)
  const discoveredFiles = discoveredItems.filter((i) => i.isFolder === false)

  const isParentFolderChecked =
    clickedFolder.type === 'folder' && clickedFolder.status === 'checked'
  const folders: PartialTreeFolderNode[] = discoveredFolders.map((folder) => {
    const existing = oldPartialTree.find(
      (item) => item.id === folder.requestPath,
    ) as PartialTreeFolderNode | undefined

    const status =
      existing?.status ?? (isParentFolderChecked ? 'checked' : 'unchecked')

    return {
      type: 'folder',
      id: folder.requestPath,
      cached: existing?.cached ?? false,
      nextPagePath: existing?.nextPagePath ?? null,
      status,
      parentId: clickedFolder.id,
      data: folder,
    }
  })
  const files: PartialTreeFile[] = discoveredFiles.map((file) => {
    const restrictionError = validateSingleFile(file)
    const existing = oldPartialTree.find(
      (item) => item.id === file.requestPath,
    ) as PartialTreeFile | undefined

    return {
      type: 'file',
      id: file.requestPath,

      restrictionError,

      status:
        existing?.status ??
        (isParentFolderChecked && !restrictionError ? 'checked' : 'unchecked'),
      parentId: clickedFolder.id,
      data: file,
    }
  })

  // just doing `clickedFolder.cached = true` in a non-mutating way
  const updatedClickedFolder: PartialTreeFolder = {
    ...clickedFolder,
    cached: true,
    nextPagePath: currentPagePath,
  }
  const partialTreeWithUpdatedClickedFolder = oldPartialTree.map((folder) =>
    folder.id === updatedClickedFolder.id ? updatedClickedFolder : folder,
  )

  const replacementIds = new Set<string>([
    ...folders.map((folder) => folder.id as string),
    ...files.map((file) => file.id as string),
  ])

  const withoutReplacedEntries = partialTreeWithUpdatedClickedFolder.filter(
    (item) => !(item.id != null && replacementIds.has(item.id as string)),
  )

  const newPartialTree = [
    ...withoutReplacedEntries,
    ...folders,
    ...files,
  ]
  return newPartialTree
}

export default afterOpenFolder
