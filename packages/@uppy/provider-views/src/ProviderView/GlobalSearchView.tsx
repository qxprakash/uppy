import type {
  Body,
  Meta,
  PartialTreeFile,
  PartialTreeFolderNode,
  UnknownProviderPlugin,
} from '@uppy/core'
import type { CompanionFile } from '@uppy/utils'
import classNames from 'classnames'
import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import Browser from '../Browser.js'
import SearchInput from '../SearchInput.js'

interface GlobalSearchViewProps<M extends Meta, B extends Body> {
  plugin: UnknownProviderPlugin<M, B>
  provider: UnknownProviderPlugin<M, B>['provider']
  openFolder: (folderId: string | null) => Promise<void>
  handleScroll: (event: Event) => Promise<void>
  onExit: () => void
}

function isSearchFunction(
  provider: GlobalSearchViewProps<any, any>['provider'],
): provider is GlobalSearchViewProps<any, any>['provider'] & {
  search: (
    query: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ items?: CompanionFile[] } | CompanionFile[]>
} {
  return typeof (provider as any)?.search === 'function'
}

function GlobalSearchView<M extends Meta, B extends Body>(
  props: GlobalSearchViewProps<M, B>,
): h.JSX.Element {
  const { plugin, provider, onExit, openFolder, handleScroll } = props
  const { searchString } = plugin.getPluginState()
  const { i18n } = plugin.uppy

  const [results, setResults] = useState<CompanionFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isSearchFunction(provider)) {
      setResults([])
      setIsLoading(false)
      setErrorMessage(null)
      return
    }

    const trimmed = searchString.trim()
    if (trimmed === '') {
      setResults([])
      setIsLoading(false)
      setErrorMessage(null)
      return
    }

    const abortController = new AbortController()
    let cancelled = false

    setIsLoading(true)
    setErrorMessage(null)

    Promise.resolve(
      provider.search(trimmed, { signal: abortController.signal }),
    )
      .then((res) => {
        if (cancelled) return
        if (Array.isArray(res)) {
          setResults(res)
          return
        }
        if (res && Array.isArray(res.items)) {
          setResults(res.items)
          return
        }
        setResults([])
      })
      .catch((err) => {
        if (cancelled) return
        if (err?.name === 'AbortError') {
          return
        }
        setResults([])
        setErrorMessage('Unable to load search results')
        plugin.uppy.log(err, 'warning')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [provider, plugin, searchString])

  const handleSearchInputChange = (value: string) => {
    plugin.setPluginState({ searchString: value })
  }

  const handleExit = () => {
    plugin.setPluginState({ searchString: '' })
    setResults([])
    onExit()
  }

  const displayedItems = useMemo(
    () =>
      results.map<(PartialTreeFile | PartialTreeFolderNode)>((item, index) => {
        const id = item.requestPath ?? `${item.name ?? 'item'}-${index}`
        if (item.isFolder) {
          const node: PartialTreeFolderNode = {
            type: 'folder',
            id,
            cached: true,
            nextPagePath: null,
            status: 'unchecked',
            parentId: null,
            data: item,
          }
          return node
        }
        const node: PartialTreeFile = {
          type: 'file',
          id,
          restrictionError: null,
          status: 'unchecked',
          parentId: null,
          data: item,
        }
        return node
      }),
    [results],
  )

  return (
    <div
      className={classNames(
        'uppy-ProviderBrowser',
        'uppy-ProviderBrowser-viewType--list',
        'uppy-ProviderBrowser--searchMode',
      )}
    >
      <div className="uppy-ProviderBrowser-searchFilter">
        <SearchInput
          searchString={searchString}
          setSearchString={handleSearchInputChange}
          submitSearchString={() => {}}
          inputLabel={i18n('search') ?? 'search'}
          clearSearchLabel={i18n('resetFilter')}
          wrapperClassName="uppy-ProviderBrowser-searchFilter"
          inputClassName="uppy-ProviderBrowser-searchFilterInput"
        />
        <button
          type="button"
          className="uppy-u-reset uppy-c-btn uppy-ProviderBrowser-searchCancel"
          onClick={handleExit}
        >
          {i18n('cancel') ?? 'Cancel'}
        </button>
      </div>

      <div className="uppy-ProviderBrowser-body">
        {isLoading && (
          <p className="uppy-ProviderBrowser-loadingIndicator">Searching...</p>
        )}
        {!isLoading && errorMessage && (
          <p className="uppy-ProviderBrowser-error">{errorMessage}</p>
        )}
        {!isLoading && !errorMessage && results.length === 0 && (
          <p className="uppy-ProviderBrowser-empty">
            {i18n('noFilesFound')}
          </p>
        )}
        {!isLoading && !errorMessage && results.length > 0 && (
          <Browser<M, B>
            toggleCheckbox={() => {}}
            displayedPartialTree={displayedItems}
            openFolder={openFolder}
            virtualList={false}
            noResultsLabel={i18n('noFilesFound')}
            handleScroll={handleScroll}
            viewType="list"
            showTitles
            i18n={i18n}
            isLoading={isLoading}
            utmSource="Companion"
          />
        )}
      </div>
    </div>
  )
}

export default GlobalSearchView
