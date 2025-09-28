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
  UnknownProviderPluginState,
} from '@uppy/core'
import type { h } from 'preact'
import Browser from '../Browser.js'
import SearchInput from '../SearchInput.js'

type ProviderPluginState = UnknownProviderPluginState & {
  searchViewState?: SearchViewState
  searchViewVersion?: number
}

interface SearchViewState {
  results: CompanionFile[]
  checkedItems: Record<string, CompanionFile>
  isLoading: boolean
  error: string | null
  lastQuery: string
}

const createDefaultSearchViewState = (): SearchViewState => ({
  results: [],
  checkedItems: {},
  isLoading: false,
  error: null,
  lastQuery: '',
})

const isSearchStatePristine = (state: SearchViewState): boolean =>
  state.results.length === 0 &&
  Object.keys(state.checkedItems).length === 0 &&
  state.isLoading === false &&
  state.error === null &&
  state.lastQuery === ''

function getItemKey(item: CompanionFile): string {
  return item.requestPath ?? item.id ?? item.name ?? ''
}

interface GlobalSearchViewOptions<M extends Meta, B extends Body> {
  provider: UnknownProviderPlugin<M, B>['provider']
  plugin: UnknownProviderPlugin<M, B>
  exitSearch: () => void
  i18n: I18n
}

export default class GlobalSearchView<M extends Meta, B extends Body> {
  private provider: UnknownProviderPlugin<M, B>['provider']

  private plugin: UnknownProviderPlugin<M, B>

  private exitSearch: () => void

  private i18n: I18n

  private abortController: AbortController | null = null

  private searchDebounceId: number | null = null

  private pendingQuery: string | null = null

  constructor(options: GlobalSearchViewOptions<M, B>) {
    this.provider = options.provider
    this.plugin = options.plugin
    this.exitSearch = options.exitSearch
    this.i18n = options.i18n
  }

  updateI18n(i18n: I18n): void {
    this.i18n = i18n
  }

  destroy(): void {
    this.clearDebounce()
    this.abortController?.abort()
    this.abortController = null
    this.pendingQuery = null
  }

  reset(): void {
    this.destroy()
    this.setState(() => createDefaultSearchViewState())
  }

  syncSearchString(searchString: string): void {
    const trimmed = searchString.trim()
    if (trimmed === '') {
      const currentState = this.getState()
      if (isSearchStatePristine(currentState)) {
        this.destroy()
      } else {
        this.reset()
      }
      return
    }

    const state = this.getState()
    if (trimmed === state.lastQuery || trimmed === this.pendingQuery) {
      return
    }
    this.scheduleSearch(trimmed)
  }

  render(searchString: string): h.JSX.Element {
    const state = this.getState()
    const checkedSet = new Set(Object.keys(state.checkedItems))
    const items: (PartialTreeFile | PartialTreeFolderNode)[] = state.results.map(
      (item) => {
        const key = getItemKey(item)
        if (item.isFolder) {
          return {
            type: 'folder',
            id: key,
            parentId: null,
            cached: true,
            nextPagePath: null,
            status: checkedSet.has(key) ? 'checked' : 'unchecked',
            data: item,
          } as PartialTreeFolderNode
        }

        return {
          type: 'file',
          id: key,
          parentId: null,
          status: checkedSet.has(key) ? 'checked' : 'unchecked',
          restrictionError: null,
          data: item,
        } as PartialTreeFile
      },
    )

    return (
      <div className="uppy-ProviderBrowser uppy-ProviderBrowser-viewType--list uppy-ProviderBrowser--searchMode">
        <div className="uppy-ProviderBrowser-searchFilter">
          <SearchInput
            searchString={searchString}
            setSearchString={this.handleSearchInput}
            submitSearchString={this.handleSubmitSearch}
            inputLabel={this.i18n('search')}
            clearSearchLabel={this.i18n('resetSearch')}
            wrapperClassName="uppy-ProviderBrowser-searchFilter"
            inputClassName="uppy-ProviderBrowser-searchFilterInput"
          />

          <button
            type="button"
            className="uppy-u-reset uppy-c-btn uppy-ProviderBrowser-searchCancel"
            onClick={this.handleExit}
          >
            {this.i18n('cancel')}
          </button>
        </div>

        <Browser<M, B>
          displayedPartialTree={items}
          viewType="list"
          toggleCheckbox={this.handleToggle}
          handleScroll={this.noopHandleScroll}
          showTitles
          i18n={this.i18n}
          isLoading={state.isLoading}
          openFolder={this.handleOpenFolder}
          noResultsLabel={state.error ?? this.i18n('noFilesFound')}
          virtualList={false}
          utmSource="Companion"
        />
      </div>
    )
  }

  private getState(): SearchViewState {
    const pluginState = this.plugin.getPluginState() as ProviderPluginState
    if (!pluginState.searchViewState) {
      const initial = createDefaultSearchViewState()
      this.plugin.setPluginState({ searchViewState: initial } as Partial<ProviderPluginState>)
      return initial
    }
    return pluginState.searchViewState
  }

  private setState(updater: (prev: SearchViewState) => SearchViewState): void {
    const pluginState = this.plugin.getPluginState() as ProviderPluginState
    const nextState = updater(
      pluginState.searchViewState ?? createDefaultSearchViewState(),
    )
    const nextVersion = (pluginState.searchViewVersion ?? 0) + 1
    this.plugin.setPluginState({
      searchViewState: nextState,
      searchViewVersion: nextVersion,
    } as Partial<ProviderPluginState>)
  }

  private scheduleSearch(query: string): void {
    this.pendingQuery = query
    this.clearDebounce()
    this.abortController?.abort()
    this.abortController = null
    this.searchDebounceId = window.setTimeout(() => {
      void this.performSearch(this.pendingQuery ?? undefined)
      this.searchDebounceId = null
    }, 500)
  }

  private clearDebounce(): void {
    if (this.searchDebounceId != null) {
      window.clearTimeout(this.searchDebounceId)
      this.searchDebounceId = null
    }
  }

  private performSearch = async (forcedQuery?: string): Promise<void> => {
    const pluginState = this.plugin.getPluginState() as ProviderPluginState & {
      partialTree: PartialTree
      currentFolderId: PartialTreeId
      searchString?: string
    }

    const query = (forcedQuery ?? pluginState.searchString ?? '').trim()
    this.pendingQuery = null
    if (!query) {
      this.reset()
      return
    }

    if (typeof (this.provider as any).search !== 'function') {
      this.setState((prev) => ({
        ...prev,
        results: [],
        isLoading: false,
        error: this.i18n('noFilesFound'),
        lastQuery: query,
      }))
      return
    }

    this.abortController?.abort()
    const controller = new AbortController()
    this.abortController = controller

    this.setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      lastQuery: query,
    }))

    try {
      const { partialTree, currentFolderId } = pluginState
      const currentFolder = partialTree.find(
        (item) => item.id === currentFolderId,
      ) as PartialTreeFolder | undefined
      const scopePath =
        currentFolder && currentFolder.type !== 'root'
          ? (currentFolder.id as PartialTreeId)
          : null

      const response = await (this.provider as any).search(query, {
        signal: controller.signal,
        path: scopePath ?? undefined,
      })

      const { items } = response ?? {}
      this.setState((prev) => ({
        ...prev,
        results: Array.isArray(items) ? items : [],
        isLoading: false,
        error: null,
        lastQuery: query,
      }))
    } catch (error: any) {
      if (error?.name === 'AbortError') return
      this.plugin.uppy.log(error, 'warning')
      this.setState((prev) => ({
        ...prev,
        isLoading: false,
        error: this.i18n('companionError'),
      }))
    }
  }

  private handleSearchInput = (value: string): void => {
    this.plugin.setPluginState({ searchString: value } as Partial<ProviderPluginState>)
    const trimmed = value.trim()
    if (trimmed === '') {
      this.pendingQuery = null
      this.reset()
      return
    }
    this.scheduleSearch(trimmed)
  }

  private handleSubmitSearch = (): void => {
    this.clearDebounce()
    const { searchString } = this.plugin.getPluginState() as ProviderPluginState & {
      searchString?: string
    }
    const trimmed = (searchString ?? '').trim()
    if (trimmed === '') {
      this.reset()
      return
    }
    void this.performSearch(trimmed)
  }

  private handleToggle = (
    node: PartialTreeFolderNode | PartialTreeFile,
    _isShiftKeyPressed: boolean,
  ): void => {
    const state = this.getState()
    const nextChecked = { ...state.checkedItems }
    if (nextChecked[node.id]) {
      delete nextChecked[node.id]
    } else {
      const match = state.results.find((item) => getItemKey(item) === node.id)
      if (match) nextChecked[node.id] = match
    }

    this.setState((prev) => ({
      ...prev,
      checkedItems: nextChecked,
    }))
  }

  private noopHandleScroll = async (): Promise<void> => {
    return
  }

  private handleOpenFolder = async (folderId: string | null): Promise<void> => {
    if (!folderId) return
    this.reset()
    this.exitSearch()
  }

  private handleExit = (): void => {
    this.reset()
    this.plugin.setPluginState({ searchString: '' } as Partial<ProviderPluginState>)
    this.exitSearch()
  }
}

export { createDefaultSearchViewState }
export type { SearchViewState }
