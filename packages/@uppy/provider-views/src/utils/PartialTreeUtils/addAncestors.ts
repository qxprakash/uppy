import type { PartialTree, PartialTreeFolder } from '@uppy/core'

function addAncestors(
  partialTree: PartialTree,
  ancestors: PartialTreeFolder[],
): PartialTree {
  const newPartialTree = [...partialTree]
  for (const ancestor of ancestors) {
    const ancestorExists = newPartialTree.some((item) => item.id === ancestor.id)
    if (!ancestorExists) {
      newPartialTree.push(ancestor)
    }
  }
  return newPartialTree
}

export default addAncestors
