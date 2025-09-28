import type { CompanionFile, I18n } from '@uppy/utils'
import type {
  Body,
  Meta,
  PartialTree,
  PartialTreeFile,
  PartialTreeFolder,
  PartialTreeFolderNode,
  PartialTreeId,
  UnknownProviderPlugin,
} from '@uppy/core'
import type { h } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import Browser from '../Browser.js'
import type ProviderView from './ProviderView.js'
import SearchInput from '../SearchInput.js'

export interface GlobalSearchViewProps<M extends Meta, B extends Body> {
  provider: UnknownProviderPlugin<M, B>['provider']
  plugin: UnknownProviderPlugin<M, B>
  searchString: string
  exitSearch: () => void
  i18n: I18n
}

function getItemKey(item: CompanionFile): string {
  return item.requestPath ?? item.id ?? item.name ?? ''
}

function GlobalSearchView<M extends Meta, B extends Body>({
  provider,
  plugin,
  searchString,
  exitSearch,
  i18n,
}: GlobalSearchViewProps<M, B>): h.JSX.Element {
  const [results, setResults] = useState<CompanionFile[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [checkedItems, setCheckedItems] = useState<Map<string, CompanionFile>>(
    () => new Map(),
  )
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const searchDebounceIdRef = useRef<number | null>(null)

  const clearDebounce = useCallback(() => {
    if (searchDebounceIdRef.current != null) {
      window.clearTimeout(searchDebounceIdRef.current)
      searchDebounceIdRef.current = null
    }
  }, [])

  const clearResults = useCallback(() => {
    clearDebounce()
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setResults([])
    setCheckedItems(new Map())
    setError(null)
    setIsLoading(false)
  }, [clearDebounce])

  const performSearch = useCallback(async () => {
    const latestState = plugin.getPluginState() as {
      searchString?: string
      partialTree: PartialTree
      currentFolderId: PartialTreeId
    }

    const query = (latestState.searchString ?? '').trim()
    if (!query) {
      clearResults()
      return
    }

    if (typeof (provider as any).search !== 'function') {
      setError(i18n('noFilesFound'))
      setResults([])
      return
    }

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    setIsLoading(true)
    setError(null)

    try {
      const { partialTree, currentFolderId } = latestState
      const currentFolder = partialTree.find(
        (i) => i.id === currentFolderId,
      ) as PartialTreeFolder | undefined
      const scopePath =
        currentFolder && currentFolder.type !== 'root'
          ? (currentFolder.id as PartialTreeId)
          : null

      const response = await (provider as any).search(query, {
        signal: controller.signal,
        path: scopePath ?? undefined,
      })
      const { items } = response ?? {}
      console.log('search response', { response })
      setResults(Array.isArray(items) ? items : [])
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setError(i18n('companionError'))
      plugin.uppy.log(err, 'warning')
    } finally {
      setIsLoading(false)
    }
  }, [clearResults, i18n, plugin, provider])

  const scheduleSearch = useCallback(() => {
    clearDebounce()
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    searchDebounceIdRef.current = window.setTimeout(() => {
      void performSearch()
      searchDebounceIdRef.current = null
    }, 500)
  }, [clearDebounce, performSearch])

  const handleSearchInput = useCallback(
    (value: string) => {
      plugin.setPluginState({ searchString: value })

      const trimmed = value.trim()
      if (trimmed === '') {
        clearResults()
      } else {
        abortControllerRef.current?.abort()
        abortControllerRef.current = null
      }
    },
    [clearResults, plugin],
  )

  const handleSubmitSearch = useCallback(() => {
    const { searchString: latest } = plugin.getPluginState() as {
      searchString?: string
    }

    const trimmed = (latest ?? '').trim()
    if (trimmed === '') {
      clearResults()
      return
    }

    clearDebounce()
    void performSearch()
  }, [clearDebounce, clearResults, performSearch, plugin])

  const toggleItem = useCallback((item: CompanionFile) => {
    const key = getItemKey(item)
    setCheckedItems((prev) => {
      const next = new Map(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.set(key, item)
      }
      return next
    })
  }, [])

  useEffect(() => {
    // Trigger an initial search when the view mounts with a pre-filled query.
    if (searchString.trim() === '') {
      clearResults()
      return
    }

    scheduleSearch()
  }, [clearResults, scheduleSearch, searchString])

  const handleExit = useCallback(() => {
    clearResults()
    exitSearch()
  }, [clearResults, exitSearch])

  const renderList = useMemo(() => {
    const items: (PartialTreeFile | PartialTreeFolderNode)[] = results.map(
      (item) => {
        const key = getItemKey(item)
        if (item.isFolder) {
          return {
            type: 'folder',
            id: key,
            parentId: null,
            cached: true,
            nextPagePath: null,
            status: checkedItems.has(key) ? 'checked' : 'unchecked',
            data: item,
          } as PartialTreeFolderNode
        }

        return {
          type: 'file',
          id: key,
          parentId: null,
          status: checkedItems.has(key) ? 'checked' : 'unchecked',
          restrictionError: null,
          data: item,
        } as PartialTreeFile
      },
    )

    const handleToggle: ProviderView<M, B>['toggleCheckbox'] = (
      node,
      _isShiftKeyPressed,
    ) => {
      const match = results.find((res) => getItemKey(res) === node.id)
      if (match) toggleItem(match)
    }

    const noopHandleScroll: ProviderView<M, B>['handleScroll'] = async () => {
      return
    }

    const openFolder: ProviderView<M, B>['openFolder'] = async (folderId) => {
      if (!folderId) return
      handleExit()
    }

    return {
      items,
      handleToggle,
      openFolder,
      noopHandleScroll,
    }
  }, [checkedItems, handleExit, results, toggleItem])

  return (
    <div className="uppy-ProviderBrowser uppy-ProviderBrowser-viewType--list uppy-ProviderBrowser--searchMode">
      <div className="uppy-ProviderBrowser-searchFilter">
        <SearchInput
          searchString={searchString}
          setSearchString={handleSearchInput}
          submitSearchString={handleSubmitSearch}
          inputLabel={i18n('search')}
          clearSearchLabel={i18n('resetSearch')}
          wrapperClassName="uppy-ProviderBrowser-searchFilter"
          inputClassName="uppy-ProviderBrowser-searchFilterInput"
        />
      </div>

      <Browser<M, B>
        displayedPartialTree={renderList.items}
        viewType="list"
        toggleCheckbox={renderList.handleToggle}
        handleScroll={renderList.noopHandleScroll}
        showTitles
        i18n={i18n}
        isLoading={isLoading}
        openFolder={renderList.openFolder}
        noResultsLabel={error ?? i18n('noFilesFound')}
        virtualList={false}
        utmSource="Companion"
      />
    </div>
  )
}

export default GlobalSearchView
