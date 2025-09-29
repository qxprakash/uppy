import type {
  PartialTree,
  PartialTreeFolder,
  PartialTreeFolderNode,
  PartialTreeId,
} from '@uppy/core'

const getBreadcrumbs = (
  partialTree: PartialTree,
  currentFolderId: PartialTreeId,
): PartialTreeFolder[] => {
  let folder = partialTree.find(
    (f) => f.id === currentFolderId,
  ) as PartialTreeFolder | undefined

  if (!folder) return []

  const breadcrumbs: PartialTreeFolder[] = []
  const rootFolder = partialTree.find(
    (f) => f.type === 'root',
  ) as PartialTreeFolder | undefined

  while (folder) {
    breadcrumbs.unshift(folder)

    if (folder.type === 'root') break

    const currentParentId = (folder as PartialTreeFolderNode).parentId

    let parent: PartialTreeFolder | undefined
    if (currentParentId == null) {
      parent = rootFolder
    } else {
      parent = partialTree.find(
        (f) => f.id === currentParentId,
      ) as PartialTreeFolder | undefined

      if (!parent && rootFolder && rootFolder.id === currentParentId) {
        parent = rootFolder
      }
    }

    if (!parent || parent === folder) break

    folder = parent
  }

  return breadcrumbs
}

export default getBreadcrumbs
