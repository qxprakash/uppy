import type { CompanionFile, I18n } from '@uppy/utils'
import type {
  Body,
  Meta,
  PartialTree,
  PartialTreeId,
  UnknownProviderPlugin,
  UnknownProviderPluginState,
} from '@uppy/core'
import type { h } from 'preact'
import Item from '../Item/index.js'
import SearchInput from '../SearchInput.js'
import {
  createAbortableDebounce,
  type AbortableDebounce,
} from '../utils/createAbortableDebounce.js'

type ProviderPluginState = UnknownProviderPluginState & {
  searchViewState?: SearchViewState
  searchViewVersion?: number
}

interface SearchEntry {
  id: string
  name: string | null
  isFolder: boolean
  icon?: string | null
  requestPath?: string | null
}

interface SearchViewState {
  entries: SearchEntry[]
  rawById: Record<string, CompanionFile>
  checkedIds: string[]
  isLoading: boolean
  error: string | null
  lastQuery: string
}

const createDefaultSearchViewState = (): SearchViewState => ({
  entries: [],
  rawById: {},
  checkedIds: [],
  isLoading: false,
  error: null,
  lastQuery: '',
})

const isSearchStatePristine = (state: SearchViewState): boolean =>
  state.entries.length === 0 &&
  state.checkedIds.length === 0 &&
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
  onNavigateToFolder: (folder: CompanionFile) => void
  i18n: I18n
}

export default class GlobalSearchView<M extends Meta, B extends Body> {
  private provider: UnknownProviderPlugin<M, B>['provider']

  private plugin: UnknownProviderPlugin<M, B>

  private exitSearch: () => void

  private onNavigateToFolder: (folder: CompanionFile) => void

  private i18n: I18n

  private readonly searchTask: AbortableDebounce<string>

  private pendingQuery: string | null = null

  constructor(options: GlobalSearchViewOptions<M, B>) {
    this.provider = options.provider
    this.plugin = options.plugin
    this.exitSearch = options.exitSearch
    this.onNavigateToFolder = options.onNavigateToFolder
    this.i18n = options.i18n

    this.searchTask = createAbortableDebounce<string>({
      delay: 500,
      handler: this.executeSearch,
    })
  }

  updateI18n(i18n: I18n): void {
    this.i18n = i18n
  }

  destroy(): void {
    this.searchTask.destroy()
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
    const checkedSet = new Set(state.checkedIds)
    const items = state.entries

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

        {this.renderResults(state, items, checkedSet, state.rawById)}
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
    this.searchTask.schedule(query)
  }

  private executeSearch = async (
    query: string,
    signal: AbortSignal,
  ): Promise<void> => {
    const pluginState = this.plugin.getPluginState() as ProviderPluginState & {
      partialTree: PartialTree
      currentFolderId: PartialTreeId
      searchString?: string
    }

    const trimmedQuery = (query ?? '').trim()
    const fallbackQuery = (pluginState.searchString ?? '').trim()
    const effectiveQuery = trimmedQuery || fallbackQuery

    this.pendingQuery = null
    if (!effectiveQuery) {
      this.reset()
      return
    }

    if (typeof (this.provider as any).search !== 'function') {
      this.setState((prev) => ({
        ...prev,
        entries: [],
        isLoading: false,
        error: this.i18n('noFilesFound'),
        lastQuery: effectiveQuery,
      }))
      return
    }

    this.setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      lastQuery: effectiveQuery,
    }))

    try {
      const { partialTree, currentFolderId } = pluginState
      const currentFolder = partialTree.find(
        (item) => item.id === currentFolderId,
      ) as { id: PartialTreeId; type: string } | undefined
      const scopePath =
        currentFolder && currentFolder.type !== 'root'
          ? (currentFolder.id as PartialTreeId)
          : null

      const response = await (this.provider as any).search(effectiveQuery, {
        signal,
        path: scopePath ?? undefined,
      })

      if (signal.aborted) return

      const { items } = response ?? {}
      const list = Array.isArray(items) ? (items as CompanionFile[]) : []
      const { entries, rawById } = this.normalizeResults(list)

      this.setState((prev) => ({
        ...prev,
        entries,
        rawById: this.mergeRawById(prev.rawById, rawById, prev.checkedIds),
        isLoading: false,
        error: null,
        lastQuery: effectiveQuery,
      }))
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal.aborted) return
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
      this.searchTask.cancel()
      this.reset()
      return
    }
    this.scheduleSearch(trimmed)
  }

  private handleSubmitSearch = (): void => {
    const { searchString } = this.plugin.getPluginState() as ProviderPluginState & {
      searchString?: string
    }
    const trimmed = (searchString ?? '').trim()
    if (trimmed === '') {
      this.reset()
      return
    }
    this.pendingQuery = trimmed
    void this.searchTask.flush(trimmed)
  }

  private normalizeResults(items: CompanionFile[]): {
    entries: SearchEntry[]
    rawById: Record<string, CompanionFile>
  } {
    const entries: SearchEntry[] = []
    const rawById: Record<string, CompanionFile> = {}

    items.forEach((item) => {
      const key = getItemKey(item)
      if (!key) return
      rawById[key] = item
      entries.push({
        id: key,
        name: item.name ?? null,
        isFolder: !!item.isFolder,
        icon: (item.thumbnail ?? item.icon) ?? null,
        requestPath: (item.requestPath ?? null) as string | null,
      })
    })

    return { entries, rawById }
  }

  private mergeRawById(
    previous: Record<string, CompanionFile>,
    next: Record<string, CompanionFile>,
    checkedIds: string[],
  ): Record<string, CompanionFile> {
    const merged: Record<string, CompanionFile> = {}

    checkedIds.forEach((id) => {
      const existing = previous[id] ?? next[id]
      if (existing) merged[id] = existing
    })

    Object.keys(next).forEach((id) => {
      merged[id] = next[id]
    })

    return merged
  }

  private handleToggle = (item: CompanionFile): void => {
    const key = getItemKey(item)
    if (!key) return

    this.setState((prev) => {
      const isChecked = prev.checkedIds.includes(key)
      const nextChecked = isChecked
        ? prev.checkedIds.filter((id) => id !== key)
        : [...prev.checkedIds, key]
      const nextRaw = { ...prev.rawById, [key]: item }

      return {
        ...prev,
        checkedIds: nextChecked,
        rawById: nextRaw,
      }
    })
  }

  private noopHandleScroll = async (): Promise<void> => {
    return
  }

  private handleOpenFolder = async (item: CompanionFile): Promise<void> => {
    if (!item.isFolder) return
    this.onNavigateToFolder(item)
  }

  private handleExit = (): void => {
    this.reset()
    this.plugin.setPluginState({ searchString: '' } as Partial<ProviderPluginState>)
    this.exitSearch()
  }

  private renderResults(
    state: SearchViewState,
    entries: SearchEntry[],
    checkedSet: Set<string>,
    rawById: Record<string, CompanionFile>,
  ): h.JSX.Element {
    if (state.isLoading) {
      return (
        <div className="uppy-Provider-loading">
          {this.i18n('loading')}
        </div>
      )
    }

    if (entries.length === 0) {
      return (
        <div className="uppy-Provider-empty">
          {state.error ?? this.i18n('noFilesFound')}
        </div>
      )
    }

    return (
      <div className="uppy-ProviderBrowser-body">
        <ul className="uppy-ProviderBrowser-list" tabIndex={-1}>
          {entries.map((entry) => this.renderResult(entry, checkedSet, rawById))}
        </ul>
      </div>
    )
  }

  private renderResult(
    entry: SearchEntry,
    checkedSet: Set<string>,
    rawById: Record<string, CompanionFile>,
  ): h.JSX.Element {
    const key = entry.id
    const isChecked = checkedSet.has(key)
    const isFolder = entry.isFolder
    const original = rawById[key]
    const companion =
      original ??
      ({
        id: entry.id,
        name: entry.name ?? undefined,
        isFolder: entry.isFolder,
        requestPath: entry.requestPath ?? undefined,
        icon: entry.icon ?? undefined,
      } as CompanionFile)
    const displayName = entry.name ?? companion.name ?? null
    const file = {
      id: key,
      name: displayName,
      type: isFolder ? 'folder' : 'file',
      icon: entry.icon ?? companion.thumbnail ?? companion.icon,
      status: isChecked ? 'checked' : 'unchecked',
      data: companion,
    } as any

    return (
      <Item
        key={file.id}
        file={file}
        viewType="list"
        showTitles
        i18n={this.i18n}
        toggleCheckbox={() => this.handleToggle(companion)}
        openFolder={() => this.handleOpenFolder(companion)}
        utmSource="Companion"
      />
    )
  }
}

export { createDefaultSearchViewState }
export type { SearchViewState }
