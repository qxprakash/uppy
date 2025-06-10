/* eslint-disable max-classes-per-file */
/* global AggregateError */

import type { h } from 'preact'
import Translator from '@uppy/utils/lib/Translator'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore untyped
import ee from 'namespace-emitter'
import { nanoid } from 'nanoid/non-secure'
import throttle from 'lodash/throttle.js'
import DefaultStore, { type Store } from '@uppy/store-default'
import getFileType from '@uppy/utils/lib/getFileType'
import getFileNameAndExtension from '@uppy/utils/lib/getFileNameAndExtension'
import { getSafeFileId } from '@uppy/utils/lib/generateFileID'
import type {
  UppyFile,
  Meta,
  Body,
  MinimalRequiredUppyFile,
} from '@uppy/utils/lib/UppyFile'
import type { CompanionFile } from '@uppy/utils/lib/CompanionFile'
import type {
  CompanionClientProvider,
  CompanionClientSearchProvider,
} from '@uppy/utils/lib/CompanionClientProvider'
import type {
  FileProgressNotStarted,
  FileProgressStarted,
} from '@uppy/utils/lib/FileProgress'
import type {
  Locale,
  I18n,
  OptionalPluralizeLocale,
} from '@uppy/utils/lib/Translator'
import supportsUploadProgress from './supportsUploadProgress.js'
import getFileName from './getFileName.js'
import { justErrorsLogger, debugLogger } from './loggers.js'
import {
  Restricter,
  defaultOptions as defaultRestrictionOptions,
  RestrictionError,
} from './Restricter.js'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore We don't want TS to generate types for the package.json
import packageJson from '../package.json'
import locale from './locale.js'

import type BasePlugin from './BasePlugin.js'
import type { Restrictions, ValidateableFile } from './Restricter.js'

type Processor = (
  fileIDs: string[],
  uploadID: string,
) => Promise<unknown> | void

type LogLevel = 'info' | 'warning' | 'error' | 'success'

export type UnknownPlugin<
  M extends Meta,
  B extends Body,
  PluginState extends Record<string, unknown> = Record<string, unknown>,
> = BasePlugin<any, M, B, PluginState>

/**
 * ids are always `string`s, except the root folder's id can be `null`
 */
export type PartialTreeId = string | null

export type PartialTreeStatusFile = 'checked' | 'unchecked'
export type PartialTreeStatus = PartialTreeStatusFile | 'partial'

export type PartialTreeFile = {
  type: 'file'
  id: string

  /**
   * There exist two types of restrictions:
   * - individual restrictions (`allowedFileTypes`, `minFileSize`, `maxFileSize`), and
   * - aggregate restrictions (`maxNumberOfFiles`, `maxTotalFileSize`).
   *
   * `.restrictionError` reports whether this file passes individual restrictions.
   *
   */
  restrictionError: string | null

  status: PartialTreeStatusFile
  parentId: PartialTreeId
  data: CompanionFile
}

export type PartialTreeFolderNode = {
  type: 'folder'
  id: string

  /**
   * Consider `(.nextPagePath, .cached)` a composite key that can represent 4 states:
   * - `{ cached: true, nextPagePath: null }` - we fetched all pages in this folder
   * - `{ cached: true, nextPagePath: 'smth' }` - we fetched 1st page, and there are still pages left to fetch in this folder
   * - `{ cached: false, nextPagePath: null }` - we didn't fetch the 1st page in this folder
   * - `{ cached: false, nextPagePath: 'someString' }` - ❌ CAN'T HAPPEN ❌
   */
  cached: boolean
  nextPagePath: PartialTreeId

  status: PartialTreeStatus
  parentId: PartialTreeId
  data: CompanionFile
}

export type PartialTreeFolderRoot = {
  type: 'root'
  id: PartialTreeId

  cached: boolean
  nextPagePath: PartialTreeId
}

export type PartialTreeFolder = PartialTreeFolderNode | PartialTreeFolderRoot

/**
 * PartialTree has the following structure.
 *
 *           FolderRoot
 *         ┌─────┴─────┐
 *     FolderNode     File
 *   ┌─────┴────┐
 *  File      File
 *
 * Root folder is called `PartialTreeFolderRoot`,
 * all other folders are called `PartialTreeFolderNode`, because they are "internal nodes".
 *
 * It's possible for `PartialTreeFolderNode` to be a leaf node if it doesn't contain any files.
 */
export type PartialTree = (PartialTreeFile | PartialTreeFolder)[]

export type UnknownProviderPluginState = {
  authenticated: boolean | undefined
  didFirstRender: boolean
  searchString: string
  loading: boolean | string
  partialTree: PartialTree
  currentFolderId: PartialTreeId
  username: string | null
}

export interface AsyncStore {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

/**
 * This is a base for a provider that does not necessarily use the Companion-assisted OAuth2 flow
 */
export interface BaseProviderPlugin {
  title: string
  icon: () => h.JSX.Element
  storage: AsyncStore
}

/*
 * UnknownProviderPlugin can be any Companion plugin (such as Google Drive)
 * that uses the Companion-assisted OAuth flow.
 * As the plugins are passed around throughout Uppy we need a generic type for this.
 * It may seems like duplication, but this type safe. Changing the type of `storage`
 * will error in the `Provider` class of @uppy/companion-client and vice versa.
 *
 * Note that this is the *plugin* class, not a version of the `Provider` class.
 * `Provider` does operate on Companion plugins with `uppy.getPlugin()`.
 */
export type UnknownProviderPlugin<
  M extends Meta,
  B extends Body,
> = UnknownPlugin<M, B, UnknownProviderPluginState> &
  BaseProviderPlugin & {
    rootFolderId: string | null
    files: UppyFile<M, B>[]
    provider: CompanionClientProvider
  }

/*
 * UnknownSearchProviderPlugin can be any search Companion plugin (such as Unsplash).
 * As the plugins are passed around throughout Uppy we need a generic type for this.
 * It may seems like duplication, but this type safe. Changing the type of `title`
 * will error in the `SearchProvider` class of @uppy/companion-client and vice versa.
 *
 * Note that this is the *plugin* class, not a version of the `SearchProvider` class.
 * `SearchProvider` does operate on Companion plugins with `uppy.getPlugin()`.
 */
export type UnknownSearchProviderPluginState = {
  isInputMode: boolean
} & Pick<
  UnknownProviderPluginState,
  'loading' | 'searchString' | 'partialTree' | 'currentFolderId'
>
export type UnknownSearchProviderPlugin<
  M extends Meta,
  B extends Body,
> = UnknownPlugin<M, B, UnknownSearchProviderPluginState> &
  BaseProviderPlugin & {
    provider: CompanionClientSearchProvider
  }

export interface UploadResult<M extends Meta, B extends Body> {
  successful?: UppyFile<M, B>[]
  failed?: UppyFile<M, B>[]
  uploadID?: string
  [key: string]: unknown
}

interface CurrentUpload<M extends Meta, B extends Body> {
  fileIDs: string[]
  step: number
  result: UploadResult<M, B>
}

// TODO: can we use namespaces in other plugins to populate this?
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface Plugins extends Record<string, Record<string, unknown> | undefined> {}

// Uppy State
export interface State<M extends Meta, B extends Body>
  extends Record<string, unknown> {
  meta: M
  capabilities: {
    uploadProgress: boolean
    individualCancellation: boolean
    resumableUploads: boolean
    isMobileDevice?: boolean
    darkMode?: boolean
  }
  currentUploads: Record<string, CurrentUpload<M, B>>
  allowNewUpload: boolean
  recoveredState: null | Required<Pick<State<M, B>, 'files' | 'currentUploads'>>
  error: string | null
  files: {
    [key: string]: UppyFile<M, B>
  }
  info: Array<{
    isHidden?: boolean
    type: LogLevel
    message: string
    details?: string | Record<string, string> | null
  }>
  plugins: Plugins
  totalProgress: number
  companion?: Record<string, string>
}

export interface UppyOptions<M extends Meta, B extends Body> {
  id?: string
  autoProceed?: boolean
  /**
   * @deprecated Use allowMultipleUploadBatches
   */
  allowMultipleUploads?: boolean
  allowMultipleUploadBatches?: boolean
  logger?: typeof debugLogger
  debug?: boolean
  restrictions: Restrictions
  meta?: M
  onBeforeFileAdded?: (
    currentFile: UppyFile<M, B>,
    files: { [key: string]: UppyFile<M, B> },
  ) => UppyFile<M, B> | boolean | undefined
  onBeforeUpload?: (files: {
    [key: string]: UppyFile<M, B>
  }) => { [key: string]: UppyFile<M, B> } | boolean
  locale?: Locale
  store?: Store<State<M, B>>
  infoTimeout?: number
}

export interface UppyOptionsWithOptionalRestrictions<
  M extends Meta,
  B extends Body,
> extends Omit<UppyOptions<M, B>, 'restrictions'> {
  restrictions?: Partial<Restrictions>
}

// The user facing type for UppyOptions used in uppy.setOptions()
/*
Provide any subset of the standard Uppy options.
Provide partial updates for complex nested options like meta and restrictions.
Use a specific type for locale ,
omit `locale` , `meta` and `restrictions` from the options type,
and intersect them with specific types for `locale`, `meta` and `restrictions`.
*/

type MinimalRequiredOptions<M extends Meta, B extends Body> = Partial<
  Omit<UppyOptions<M, B>, 'locale' | 'meta' | 'restrictions'> & {
    locale: OptionalPluralizeLocale
    meta: Partial<M>
    restrictions: Partial<Restrictions>
  }
>

export type NonNullableUppyOptions<M extends Meta, B extends Body> = Required<
  UppyOptions<M, B>
>

export interface _UppyEventMap<M extends Meta, B extends Body> {
  'back-online': () => void
  'cancel-all': () => void
  complete: (result: UploadResult<M, B>) => void
  error: (
    error: { name: string; message: string; details?: string },
    file?: UppyFile<M, B>,
    response?: UppyFile<M, B>['response'],
  ) => void
  'file-added': (file: UppyFile<M, B>) => void
  'file-removed': (file: UppyFile<M, B>) => void
  'files-added': (files: UppyFile<M, B>[]) => void
  'info-hidden': () => void
  'info-visible': () => void
  'is-offline': () => void
  'is-online': () => void
  'pause-all': () => void
  'plugin-added': (plugin: UnknownPlugin<any, any>) => void
  'plugin-remove': (plugin: UnknownPlugin<any, any>) => void
  'postprocess-complete': (
    file: UppyFile<M, B> | undefined,
    progress?: NonNullable<FileProgressStarted['preprocess']>,
  ) => void
  'postprocess-progress': (
    file: UppyFile<M, B> | undefined,
    progress: NonNullable<FileProgressStarted['postprocess']>,
  ) => void
  'preprocess-complete': (
    file: UppyFile<M, B> | undefined,
    progress?: NonNullable<FileProgressStarted['preprocess']>,
  ) => void
  'preprocess-progress': (
    file: UppyFile<M, B> | undefined,
    progress: NonNullable<FileProgressStarted['preprocess']>,
  ) => void
  progress: (progress: number) => void
  restored: (pluginData: any) => void
  'restore-confirmed': () => void
  'restore-canceled': () => void
  'restriction-failed': (file: UppyFile<M, B> | undefined, error: Error) => void
  'resume-all': () => void
  'retry-all': (files: UppyFile<M, B>[]) => void
  'state-update': (
    prevState: State<M, B>,
    nextState: State<M, B>,
    patch?: Partial<State<M, B>>,
  ) => void
  upload: (uploadID: string, files: UppyFile<M, B>[]) => void
  'upload-error': (
    file: UppyFile<M, B> | undefined,
    error: { name: string; message: string; details?: string },
    response?:
      | Omit<NonNullable<UppyFile<M, B>['response']>, 'uploadURL'>
      | undefined,
  ) => void
  'upload-pause': (file: UppyFile<M, B> | undefined, isPaused: boolean) => void
  'upload-progress': (
    file: UppyFile<M, B> | undefined,
    progress: FileProgressStarted,
  ) => void
  'upload-retry': (file: UppyFile<M, B>) => void
  'upload-stalled': (
    error: { message: string; details?: string },
    files: UppyFile<M, B>[],
  ) => void
  'upload-success': (
    file: UppyFile<M, B> | undefined,
    response: NonNullable<UppyFile<M, B>['response']>,
  ) => void
}

export interface UppyEventMap<M extends Meta, B extends Body>
  extends _UppyEventMap<M, B> {
  'upload-start': (files: UppyFile<M, B>[]) => void
}

/** `OmitFirstArg<typeof someArray>` is the type of the returned value of `someArray.slice(1)`. */
type OmitFirstArg<T> = T extends [any, ...infer U] ? U : never

const defaultUploadState = {
  totalProgress: 0,
  allowNewUpload: true,
  error: null,
  recoveredState: null,
}

/**
 * Uppy Core module.
 * Manages plugins, state updates, acts as an event bus,
 * adds/removes files and metadata.
 */
export class Uppy<
  M extends Meta = Meta,
  B extends Body = Record<string, never>,
> {
  static VERSION = packageJson.version

  #plugins: Record<string, UnknownPlugin<M, B>[]> = Object.create(null)

  #restricter

  #storeUnsubscribe

  #emitter = ee()

  #preProcessors: Set<Processor> = new Set()

  #uploaders: Set<Processor> = new Set()

  #postProcessors: Set<Processor> = new Set()

  defaultLocale: OptionalPluralizeLocale

  locale!: Locale

  // The user optionally passes in options, but we set defaults for missing options.
  // We consider all options present after the contructor has run.
  opts: NonNullableUppyOptions<M, B>

  store: NonNullableUppyOptions<M, B>['store']

  // Warning: do not use this from a plugin, as it will cause the plugins' translations to be missing
  i18n!: I18n

  i18nArray!: Translator['translateArray']

  scheduledAutoProceed: ReturnType<typeof setTimeout> | null = null

  wasOffline = false

  /**
   * Instantiate Uppy
   */
  constructor(opts?: UppyOptionsWithOptionalRestrictions<M, B>) {
    this.defaultLocale = locale

    const defaultOptions: UppyOptions<Record<string, unknown>, B> = {
      id: 'uppy',
      autoProceed: false,
      allowMultipleUploadBatches: true,
      debug: false,
      restrictions: defaultRestrictionOptions,
      meta: {},
      onBeforeFileAdded: (file, files) => !Object.hasOwn(files, file.id),
      onBeforeUpload: (files) => files,
      store: new DefaultStore(),
      logger: justErrorsLogger,
      infoTimeout: 5000,
    }

    const merged = { ...defaultOptions, ...opts } as Omit<
      NonNullableUppyOptions<M, B>,
      'restrictions'
    >
    // Merge default options with the ones set by user,
    // making sure to merge restrictions too
    this.opts = {
      ...merged,
      restrictions: {
        ...(defaultOptions.restrictions as Restrictions),
        ...(opts && opts.restrictions),
      },
    }

    // Support debug: true for backwards-compatability, unless logger is set in opts
    // opts instead of this.opts to avoid comparing objects — we set logger: justErrorsLogger in defaultOptions
    if (opts && opts.logger && opts.debug) {
      this.log(
        'You are using a custom `logger`, but also set `debug: true`, which uses built-in logger to output logs to console. Ignoring `debug: true` and using your custom `logger`.',
        'warning',
      )
    } else if (opts && opts.debug) {
      this.opts.logger = debugLogger
    }

    this.log(`Using Core v${Uppy.VERSION}`)

    this.i18nInit()

    // this.opts.store is the store that Uppy will use to manage its state.
    // currently set to new DefaultStore()
    this.store = this.opts.store

    // setting default state
    this.setState({
      ...defaultUploadState,
      plugins: {},
      files: {},
      currentUploads: {},
      capabilities: {
        uploadProgress: supportsUploadProgress(),
        individualCancellation: true,
        resumableUploads: false,
      },
      meta: { ...this.opts.meta },
      info: [],
    })


  // Restricter is a utility that validates files against the restrictions set in Uppy options.
    this.#restricter = new Restricter<M, B>(
      () => this.opts,
      () => this.i18n,
    )


    // DefaultStore subscribe method returns a function that unsubscribes the listener
    // i.e. delete the listener from the callbacks set
    this.#storeUnsubscribe = this.store.subscribe(
      // The function passed to subscribe method of the DefaultStore class
      // is will be added to the callbacks set to be called whenever the state changes (i.e. SetState) is called.
      // it's setState method at the end it calls this.#publish(prevState, nextState, patch)
      // inside publish
      // each listener is called --
      /*
          this.#callbacks.forEach((listener) => {
            listener(...args)
          })
      */
      (prevState, nextState, patch) => {
        // now it makes sense to emit the `state-update` event when a state change occurs
        // so that whenever the state changes, this event will be emitted
        this.emit('state-update', prevState, nextState, patch)
        // update all method is a method of the basePlugin class when updates state of all the plugins
        this.updateAll(nextState)
      },
    )

    // Exposing uppy object on window for debugging and testing
    if (this.opts.debug && typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore Mutating the global object for debug purposes


      // This is a way to expose the Uppy instance globally, so that it can be accessed from the browser console.
      // this is doing window[uppy.id (which is a string (can be set using newUppy(id: "myUppy")) with default value 'uppy')]
      // this is doing window["uppy"] or window["myUppy"] = this
      // By doing this, the Uppy instance becomes directly accessible from the browser's developer console.
      // For example, if the Uppy instance has the default ID 'uppy' and debug is true,
      // a developer can open the browser console and type: uppy
      // This would display the Uppy instance, allowing them to inspect its properties, current state, and methods.

      window[this.opts.id] = this
    }

    this.#addListeners()
  }

  // ? Done
  emit<T extends keyof UppyEventMap<M, B>>(
    event: T,
    ...args: Parameters<UppyEventMap<M, B>[T]>
  ): void {
    this.#emitter.emit(event, ...args)
  }


  /*
   why this is being returned ?
   Method chaining is a common programming pattern where multiple methods are called on the same object
   consecutively in a single statement. Each method in the chain (except possibly the last one) returns
   the object itself (this), allowing the next method to be called on it.

  Conciseness and Readability: It allows developers to register multiple event listeners on the
 same Uppy instance in a more fluent and compact way.

  Convenience: It's a common convention in event emitter libraries and many other JavaScript libraries.

Instead of writing:

const uppy = new Uppy();

uppy.on('file-added', (file) => {
  console.log('File added:', file);
});
uppy.on('upload-success', (file, response) => {
  console.log('Upload successful:', file, response);
});

We can write:

const uppy = new Uppy();

uppy
  .on('file-added', (file) => {
    console.log('File added:', file);
  })
  .on('upload-success', (file, response) => {
    console.log('Upload successful:', file, response);
  })

  */


// The this.#emitter.on(event, callback) line does the actual work of registering the event listener with the internal event
// emitter instance (this.#emitter). The return this line then simply returns the Uppy instance itself,
// making the next .on(...) call (or any other Uppy method) possible on the same line.
  // ? Done
  on<K extends keyof UppyEventMap<M, B>>(
    event: K,
    callback: UppyEventMap<M, B>[K],
  ): this {
    this.#emitter.on(event, callback)
    return this
  }

  // ? Done
  once<K extends keyof UppyEventMap<M, B>>(
    event: K,
    callback: UppyEventMap<M, B>[K],
  ): this {
    this.#emitter.once(event, callback)
    return this
  }

  // ? Done
  off<K extends keyof UppyEventMap<M, B>>(
    event: K,
    callback: UppyEventMap<M, B>[K],
  ): this {
    this.#emitter.off(event, callback)
    return this
  }

  /**
   * Iterate on all plugins and run `update` on them.
   * Called each time state changes.
   *
   */

  // ? Done
  updateAll(state: Partial<State<M, B>>): void {
    this.iteratePlugins((plugin: UnknownPlugin<M, B>) => {
      plugin.update(state)
    })
  }

  /**
   * Updates state with a patch
   */
  // ? Done
  setState(patch?: Partial<State<M, B>>): void {
    this.store.setState(patch)
  }

  /**
   * Returns current state.
   */
  // ? Done
  getState(): State<M, B> {
    return this.store.getState()
  }





  // pathFilesState is designed to update the state of multiple files in a "patch" or partial manner.
  // It allows you to provide new state information for specific files, and it will merge this new information
  // with the existing state of those files. example needed

// example Imagine the current files state is :
/*
{
  "file1": { id: "file1", name: "image.jpg", progress: { percentage: 10 }, meta: {} },
  "file2": { id: "file2", name: "document.pdf", progress: { percentage: 0 }, meta: {} }
}

If you call:

uppy.patchFilesState({
  "file1": { progress: { percentage: 50, bytesUploaded: 500 } }, // Update progress for file1
  "file2": { error: "Network issue" }                             // Add an error to file2
});

The new files state would become:

{
  "file1": { id: "file1", name: "image.jpg", progress: { percentage: 50, bytesUploaded: 500 }, meta: {} }, - updated progress
  "file2": { id: "file2", name: "document.pdf", progress: { percentage: 0 }, meta: {}, error: "Network issue" } - error added
}

*/

// ? Done
  patchFilesState(filesWithNewState: {
    [id: string]: Partial<UppyFile<M, B>>
  }): void {

  // 1. Get the current state of all files.
    // `this.getState().files` returns an object where keys are file IDs
    // and values are the UppyFile objects.
    const existingFilesState = this.getState().files

    this.setState({
      // 3. The 'files' property of the state is being updated.
      files: {
        //  4. Spread all existing files into the new 'files' object.
        // This ensures that files not being patched remain unchanged.
        ...existingFilesState,
      // 5. Process the `filesWithNewState` object to create an object
        //    containing only the files that need to be updated, with their
        //    newly merged states.
        ...Object.fromEntries(
          // 5a. `Object.entries(filesWithNewState)` converts the input object
          //     (e.g., { fileId1: { progress: 50 }, fileId2: { error: 'failed' } })
          //     into an array of [key, value] pairs:
          //     [ [fileId1, { progress: 50 }], [fileId2, { error: 'failed' }] ]
          Object.entries(filesWithNewState).map(([fileID, newFileState]) => [
            // 5b. For each file being patched:
            fileID, // File ID remains the same
            {
              // 5c. Take the current state of this specific file.
              ...existingFilesState[fileID],
              // 5d. Spread the `newFileState` (the patch) over it.
              //     This merges the new properties. If a property exists in both,
              //     the one from `newFileState` overwrites the existing one.
              //     New properties from `newFileState` are added.
              ...newFileState,
            },
          ]),
        ),
        // 6. The result of `Object.fromEntries(...)` is an object like:
        //    { fileId1: { ...mergedStateForFile1... }, fileId2: { ...mergedStateForFile2... } }
        //    This object is then spread over `existingFilesState`.
        //    Effectively, it overwrites the entries for `fileId1` and `fileId2`
        //    in the `files` object with their new, merged states.
      },
    })
  }

  /**
   * Shorthand to set state for a specific file.
   */

  // ? Done
  setFileState(fileID: string, state: Partial<UppyFile<M, B>>): void {
    if (!this.getState().files[fileID]) {
      throw new Error(
        `Can’t set state for ${fileID} (the file could have been removed)`,
      )
    }

    this.patchFilesState({ [fileID]: state })
  }

  // ? Done
  i18nInit(): void {
    const onMissingKey = (key: string): void =>
      this.log(`Missing i18n string: ${key}`, 'error')

    const translator = new Translator([this.defaultLocale, this.opts.locale], {
      onMissingKey,
    })

    // this.i18n = translator.translate.bind(translator)
    // The translate method of the Translator instance is assigned to this.i18n.
    // .bind(translator) ensures that when this.i18n('someKey') is called, this inside the
    // translate method correctly refers to the translator instance.
    // this.i18n becomes the primary function Uppy and its plugins will use to get translated strings. For example,
    // this.i18n('chooseFiles') would return the translation for the "Choose files" string.


    // if we don't bind the translator , `this` inside the `translate` method
    // will likely be `undefined` as it will be called as a standalone function
    // binding ensures that `this` inside the `translate` method always
    // refers to the `translator` instance, allowing access to its properties and methods.
    this.i18n = translator.translate.bind(translator)
    this.i18nArray = translator.translateArray.bind(translator)
    this.locale = translator.locale
  }

// is used to update the configuration options of an existing Uppy instance after it has been initialized.
// ? Done
setOptions(newOpts: MinimalRequiredOptions<M, B>): void {
    this.opts = {
      ...this.opts,
      ...(newOpts as UppyOptions<M, B>),
      restrictions: {
        ...this.opts.restrictions,
        ...(newOpts?.restrictions as Restrictions),
      },
    }

    if (newOpts.meta) {
      this.setMeta(newOpts.meta)
    }

    this.i18nInit()

    if (newOpts.locale) {
      this.iteratePlugins((plugin) => {
        plugin.setOptions(newOpts)
      })
    }

    // Note: this is not the preact `setState`, it's an internal function that has the same name.
    this.setState(undefined) // so that UI re-renders with new options
  }

  // ? Done
  resetProgress(): void {
    const defaultProgress: Omit<FileProgressNotStarted, 'bytesTotal'> = {
      percentage: 0,
      bytesUploaded: false,
      uploadComplete: false,
      uploadStarted: null,
    }
    const files = { ...this.getState().files }
    const updatedFiles: State<M, B>['files'] = Object.create(null)

    Object.keys(files).forEach((fileID) => {
      updatedFiles[fileID] = {
        ...files[fileID],
        progress: {
          ...files[fileID].progress,
          ...defaultProgress,
        },
        // @ts-expect-error these typed are inserted
        // into the namespace in their respective packages
        // but core isn't ware of those
        tus: undefined,
        transloadit: undefined,
      }
    })

    this.setState({ files: updatedFiles, ...defaultUploadState })
  }

  // The clear method is designed to reset the Uppy instance to a clean state,
  // Effectively removing all files and resetting upload-related progress and error information.
  // ? Done
  clear(): void {
    const { capabilities, currentUploads } = this.getState()
    if (
      Object.keys(currentUploads).length > 0 &&
      !capabilities.individualCancellation
    ) {
      throw new Error(
        'The installed uploader plugin does not allow removing files during an upload.',
      )
    }

    this.setState({ ...defaultUploadState, files: {} })
  }

  // ? Done
  addPreProcessor(fn: Processor): void {
    this.#preProcessors.add(fn)
  }

  // ? Done
  removePreProcessor(fn: Processor): boolean {
    return this.#preProcessors.delete(fn)
  }

  // ? Done
  addPostProcessor(fn: Processor): void {
    this.#postProcessors.add(fn)
  }

  // ? Done
  removePostProcessor(fn: Processor): boolean {
    return this.#postProcessors.delete(fn)
  }

  // ? Done
  addUploader(fn: Processor): void {
    this.#uploaders.add(fn)
  }

  // ? Done
  removeUploader(fn: Processor): boolean {
    return this.#uploaders.delete(fn)
  }

  // ? Done
  setMeta(data: Partial<M>): void {
    const updatedMeta = { ...this.getState().meta, ...data }
    const updatedFiles = { ...this.getState().files }

    Object.keys(updatedFiles).forEach((fileID) => {
      updatedFiles[fileID] = {
        ...updatedFiles[fileID],
        meta: { ...updatedFiles[fileID].meta, ...data },
      }
    })

    this.log('Adding metadata:')
    this.log(data)

    this.setState({
      meta: updatedMeta,
      files: updatedFiles,
    })
  }

  // ? Done
  setFileMeta(fileID: string, data: State<M, B>['meta']): void {
    const updatedFiles = { ...this.getState().files }
    if (!updatedFiles[fileID]) {
      this.log(
        `Was trying to set metadata for a file that has been removed: ${fileID}`,
      )
      return
    }
    // spread the existing meta and the new data which is the new meta , this would merge and update the meta object
    const newMeta = { ...updatedFiles[fileID].meta, ...data }
    updatedFiles[fileID] = { ...updatedFiles[fileID], meta: newMeta }
    this.setState({ files: updatedFiles })
  }

  /**
   * Get a file object.
   */
  // ? Done
  getFile(fileID: string): UppyFile<M, B> {
    return this.getState().files[fileID]
  }

  /**
   * Get all files in an array.
   */
  // ? Done
  getFiles(): UppyFile<M, B>[] {
    const { files } = this.getState()
    return Object.values(files)
  }

  // ? Done
  getFilesByIds(ids: string[]): UppyFile<M, B>[] {
    return ids.map((id) => this.getFile(id))
  }

  getObjectOfFilesPerState(): {
    newFiles: UppyFile<M, B>[]
    startedFiles: UppyFile<M, B>[]
    uploadStartedFiles: UppyFile<M, B>[]
    pausedFiles: UppyFile<M, B>[]
    completeFiles: UppyFile<M, B>[]
    erroredFiles: UppyFile<M, B>[]
    inProgressFiles: UppyFile<M, B>[]
    inProgressNotPausedFiles: UppyFile<M, B>[]
    processingFiles: UppyFile<M, B>[]
    isUploadStarted: boolean
    isAllComplete: boolean
    isAllErrored: boolean
    isAllPaused: boolean
    isUploadInProgress: boolean
    isSomeGhost: boolean
  } {
    const { files: filesObject, totalProgress, error } = this.getState()
    const files = Object.values(filesObject)

    const inProgressFiles: UppyFile<M, B>[] = []
    const newFiles: UppyFile<M, B>[] = []
    const startedFiles: UppyFile<M, B>[] = []
    const uploadStartedFiles: UppyFile<M, B>[] = []
    const pausedFiles: UppyFile<M, B>[] = []
    const completeFiles: UppyFile<M, B>[] = []
    const erroredFiles: UppyFile<M, B>[] = []
    const inProgressNotPausedFiles: UppyFile<M, B>[] = []
    const processingFiles: UppyFile<M, B>[] = []

    for (const file of files) {
      const { progress } = file

      if (!progress.uploadComplete && progress.uploadStarted) {
        inProgressFiles.push(file)
        if (!file.isPaused) {
          inProgressNotPausedFiles.push(file)
        }
      }
      if (!progress.uploadStarted) {
        newFiles.push(file)
      }
      if (
        progress.uploadStarted ||
        progress.preprocess ||
        progress.postprocess
      ) {
        startedFiles.push(file)
      }
      if (progress.uploadStarted) {
        uploadStartedFiles.push(file)
      }
      if (file.isPaused) {
        pausedFiles.push(file)
      }
      if (progress.uploadComplete) {
        completeFiles.push(file)
      }
      if (file.error) {
        erroredFiles.push(file)
      }
      if (progress.preprocess || progress.postprocess) {
        processingFiles.push(file)
      }
    }

    return {
      newFiles,
      startedFiles,
      uploadStartedFiles,
      pausedFiles,
      completeFiles,
      erroredFiles,
      inProgressFiles,
      inProgressNotPausedFiles,
      processingFiles,

      isUploadStarted: uploadStartedFiles.length > 0,
      isAllComplete:
        totalProgress === 100 &&
        completeFiles.length === files.length &&
        processingFiles.length === 0,
      isAllErrored: !!error && erroredFiles.length === files.length,
      isAllPaused:
        inProgressFiles.length !== 0 &&
        pausedFiles.length === inProgressFiles.length,
      isUploadInProgress: inProgressFiles.length > 0,
      isSomeGhost: files.some((file) => file.isGhost),
    }
  }

  // ? Done !
  // process list of errors and communicate them to the uppy's event system
  #informAndEmit(
    errors: {
      name: string
      message: string
      isUserFacing?: boolean
      details?: string
      isRestriction?: boolean
      file?: UppyFile<M, B>
    }[],
  ): void {
    for (const error of errors) {
      if (error.isRestriction) {
// If error.isRestriction is true, it emits a 'restriction-failed' event
// plugins and UI components can listen to this and react acordingly for restriction errors
        this.emit(
          'restriction-failed',
          error.file,
          error as RestrictionError<M, B>,
        )
      } else {
        // else return a generic error event , which will trigger the errorHandler
        this.emit('error', error, error.file)
      }
      this.log(error, 'warning')
    }

    // filter out user-facing errors
    const userFacingErrors = errors.filter((error) => error.isUserFacing)

    // don't flood the user: only show the first 4 toasts
    const maxNumToShow = 4
    const firstErrors = userFacingErrors.slice(0, maxNumToShow)
    const additionalErrors = userFacingErrors.slice(maxNumToShow)
    firstErrors.forEach(({ message, details = '' }) => {
      // ! inside info() method `info-visible` event is emitted
      this.info({ message, details }, 'error', this.opts.infoTimeout)
    })

    //
    if (additionalErrors.length > 0) {
      // below message is passed to this.info method and message is translated using
      // i18n method , and count is passed as an options object to fill in the placeholder
      // of the message
      // example message: "There were 3 additional errors"
      this.info({
        message: this.i18n('additionalRestrictionsFailed', {
          count: additionalErrors.length,
        }),
      })
    }
  }

  // ? No Need to delve into this for now seems obvious with the definition
  validateRestrictions(
    file: ValidateableFile<M, B>,
    files: ValidateableFile<M, B>[] = this.getFiles(),
  ): RestrictionError<M, B> | null {
    try {
      this.#restricter.validate(files, [file])
    } catch (err) {
      return err as any
    }
    return null
  }

  // ? No Need to delve into this for now seems obvious with the definition
  validateSingleFile(file: ValidateableFile<M, B>): string | null {
    try {
      this.#restricter.validateSingleFile(file)
    } catch (err) {
      return err.message
    }
    return null
  }

  // ? No Need to delve into this for now seems obvious with the definition
  validateAggregateRestrictions(
    files: ValidateableFile<M, B>[],
  ): string | null {
    const existingFiles = this.getFiles()
    try {
      this.#restricter.validateAggregateRestrictions(existingFiles, files)
    } catch (err) {
      return err.message
    }
    return null
  }

  // ? No Need to delve into this for now seems obvious with the definition
  // ! inside checkRequiredMetaFieldsOnFile `restriction-failed` event is emitted
  #checkRequiredMetaFieldsOnFile(file: UppyFile<M, B>): boolean {
    const { missingFields, error } =
      this.#restricter.getMissingRequiredMetaFields(file)

    if (missingFields.length > 0) {
      this.setFileState(file.id, { missingRequiredMetaFields: missingFields })
      this.log(error.message)
      this.emit('restriction-failed', file, error)
      return false
    }
    if (missingFields.length === 0 && file.missingRequiredMetaFields) {
      this.setFileState(file.id, { missingRequiredMetaFields: [] })
    }
    return true
  }

  // ? No Need to delve into this for now seems obvious with the definition
  #checkRequiredMetaFields(files: State<M, B>['files']): boolean {
    let success = true
    for (const file of Object.values(files)) {
      // ! checkRequiredMetaFields emits `restriction-failed` event if missingFields.length > 0
      if (!this.#checkRequiredMetaFieldsOnFile(file)) {
        success = false
      }
    }
    return success
  }

  // ? No Need to delve into this for now seems obvious with the definition
  #assertNewUploadAllowed(file?: UppyFile<M, B>): void {
    const { allowNewUpload } = this.getState()

    if (allowNewUpload === false) {
      const error = new RestrictionError<M, B>(
        this.i18n('noMoreFilesAllowed'),
        {
          file,
        },
      )
      // ! inside informAndEmit `restriction-failed` or `error` event is emitted
      // depending on the error.isUserFacing property
      this.#informAndEmit([error])
      throw error
    }
  }

  // ? No Need to delve into this for now seems obvious with the definition
  checkIfFileAlreadyExists(fileID: string): boolean {
    const { files } = this.getState()

    if (files[fileID] && !files[fileID].isGhost) {
      return true
    }
    return false
  }

  /**
   * Create a file state object based on user-provided `addFile()` options.
   */
  // * should look in more detail but fine for now
  #transformFile(fileDescriptorOrFile: File | UppyFile<M, B>): UppyFile<M, B> {
    // Uppy expects files in { name, type, size, data } format.
    // If the actual File object is passed from input[type=file] or drag-drop,
    // we normalize it to match Uppy file object
    const file = (
      fileDescriptorOrFile instanceof File ?
        {
          name: fileDescriptorOrFile.name,
          type: fileDescriptorOrFile.type,
          size: fileDescriptorOrFile.size,
          data: fileDescriptorOrFile,
        }
      : fileDescriptorOrFile) as UppyFile<M, B>

    const fileType = getFileType(file)
    const fileName = getFileName(fileType, file)
    const fileExtension = getFileNameAndExtension(fileName).extension
    const id = getSafeFileId(file, this.getID())

    const meta = file.meta || {}
    meta.name = fileName
    meta.type = fileType

    // `null` means the size is unknown.
    const size =
      Number.isFinite(file.data.size) ? file.data.size : (null as never)

    return {
      source: file.source || '',
      id,
      name: fileName,
      extension: fileExtension || '',
      meta: {
        ...this.getState().meta,
        ...meta,
      },
      type: fileType,
      data: file.data,
      progress: {
        percentage: 0,
        bytesUploaded: false,
        bytesTotal: size,
        uploadComplete: false,
        uploadStarted: null,
      },
      size,
      isGhost: false,
      isRemote: file.isRemote || false,
      remote: file.remote,
      preview: file.preview,
    }
  }

  // Schedule an upload if `autoProceed` is enabled.

  // ? No Need to delve into this for now seems obvious with the definition
  #startIfAutoProceed(): void {
    if (this.opts.autoProceed && !this.scheduledAutoProceed) {
      // ? Prakash's Question: why even schedule this ? with 4 ms delay shouldn't this be done immediately ?
      this.scheduledAutoProceed = setTimeout(() => {
        this.scheduledAutoProceed = null
        this.upload().catch((err) => {
          if (!err.isRestriction) {
            this.log(err.stack || err.message || err)
          }
        })
      }, 4)
    }
  }


  // * went through it but need to revisit specially the last part
  #checkAndUpdateFileState(filesToAdd: UppyFile<M, B>[]): {
    nextFilesState: State<M, B>['files']
    validFilesToAdd: UppyFile<M, B>[]
    errors: RestrictionError<M, B>[]
  } {
    const { files: existingFiles } = this.getState()

    // create a copy of the files object only once
    const nextFilesState = { ...existingFiles }
    const validFilesToAdd: UppyFile<M, B>[] = []
    const errors: RestrictionError<M, B>[] = []

    for (const fileToAdd of filesToAdd) {
      try {
        // ? transformFile is used to create a file state object based on user-provided `addFile()` options.
        // ? and returns a UppyFile<M, B> object
        let newFile = this.#transformFile(fileToAdd)

        // If a file has been recovered (Golden Retriever), but we were unable to recover its data (probably too large),
        // users are asked to re-select these half-recovered files and then this method will be called again.
        // In order to keep the progress, meta and everything else, we keep the existing file,
        // but we replace `data`, and we remove `isGhost`, because the file is no longer a ghost now
        const isGhost = existingFiles[newFile.id]?.isGhost
        if (isGhost) {
          const existingFileState = existingFiles[newFile.id]
          newFile = {
            ...existingFileState,
            isGhost: false,
            data: fileToAdd.data,
          }
          this.log(
            `Replaced the blob in the restored ghost file: ${newFile.name}, ${newFile.id}`,
          )
        }

        // onBeforeFileAdded is a boolean which indicates whether the file id already
        // exists in the files array or not.
        // If it returns false (meaning that file is a duplicate), the file will not be added.
        // Uppy will typically prevent the file from being added and might show a "noDuplicates" error.
        const onBeforeFileAddedResult = this.opts.onBeforeFileAdded(
          newFile,
          nextFilesState,
        )

        if (
          !onBeforeFileAddedResult &&
          this.checkIfFileAlreadyExists(newFile.id)
        ) {
          // thorw a RestrictionError if the file is a duplicate
          throw new RestrictionError(
            this.i18n('noDuplicates', {
              fileName: newFile.name ?? this.i18n('unnamed'),
            }),
            { file: fileToAdd },
          )
        }

        // Pass through reselected files from Golden Retriever

        /*
        A "ghost" file is a file whose metadata was restored by a plugin like Golden Retriever,
        but its actual data (the blob) was missing and needs to be re-selected by the user.
        */
        if (onBeforeFileAddedResult === false && !isGhost) {
          // Don’t show UI info for this error, as it should be done by the developer
          throw new RestrictionError(
            'Cannot add the file because onBeforeFileAdded returned false.',
            { isUserFacing: false, file: fileToAdd },
          )
        }
        // this will be the where user has provided their own onBeforeFileAdded implementation which would return UppyFile
        else if (
          typeof onBeforeFileAddedResult === 'object' &&
          onBeforeFileAddedResult !== null
        ) {

          newFile = onBeforeFileAddedResult
        }

        this.#restricter.validateSingleFile(newFile)

        // need to add it to the new local state immediately, so we can use the state to validate the next files too
        nextFilesState[newFile.id] = newFile
        validFilesToAdd.push(newFile)
      } catch (err) {
        errors.push(err as any)
      }
    }

    try {
      // need to run this separately because it's much more slow, so if we run it inside the for-loop it will be very slow
      // when many files are added
      this.#restricter.validateAggregateRestrictions(
        Object.values(existingFiles),
        validFilesToAdd,
      )
    } catch (err) {
      errors.push(err as any)

      // If we have any aggregate error, don't allow adding this batch
      return {
        nextFilesState: existingFiles,
        validFilesToAdd: [],
        errors,
      }
    }

    return {
      nextFilesState,
      validFilesToAdd,
      errors,
    }
  }

  /**
   * Add a new file to `state.files`. This will run `onBeforeFileAdded`,
   * try to guess file type in a clever way, check file against restrictions,
   * and start an upload if `autoProceed === true`.
   */

  // ? done
  addFile(file: File | MinimalRequiredUppyFile<M, B>): UppyFile<M, B>['id'] {

    // if State.allowNewUpload is false, this will throw an restriction error and
    // call #informAndEmit which would emit a `restriction-failed` event or `error` event
    // depending on the error.isUserFacing property
    this.#assertNewUploadAllowed(file as UppyFile<M, B>)

    const { nextFilesState, validFilesToAdd, errors } =
      this.#checkAndUpdateFileState([file as UppyFile<M, B>])

    const restrictionErrors = errors.filter((error) => error.isRestriction)
    this.#informAndEmit(restrictionErrors)

    if (errors.length > 0) throw errors[0]

    this.setState({ files: nextFilesState })


    // This says: "Take the array validFilesToAdd. Create a new constant called firstValidFileToAdd.
    // Assign the value of the first element (at index 0) of the validFilesToAdd array to firstValidFileToAdd."
    const [firstValidFileToAdd] = validFilesToAdd

    this.emit('file-added', firstValidFileToAdd)
    this.emit('files-added', validFilesToAdd)
    this.log(
      `Added file: ${firstValidFileToAdd.name}, ${firstValidFileToAdd.id}, mime type: ${firstValidFileToAdd.type}`,
    )

    this.#startIfAutoProceed()

    return firstValidFileToAdd.id
  }

  /**
   * Add multiple files to `state.files`. See the `addFile()` documentation.
   *
   * If an error occurs while adding a file, it is logged and the user is notified.
   * This is good for UI plugins, but not for programmatic use.
   * Programmatic users should usually still use `addFile()` on individual files.
   */
  addFiles(fileDescriptors: MinimalRequiredUppyFile<M, B>[]): void {
    this.#assertNewUploadAllowed()

    const { nextFilesState, validFilesToAdd, errors } =
      this.#checkAndUpdateFileState(fileDescriptors as UppyFile<M, B>[])

    const restrictionErrors = errors.filter((error) => error.isRestriction)
    this.#informAndEmit(restrictionErrors)

    const nonRestrictionErrors = errors.filter((error) => !error.isRestriction)

    if (nonRestrictionErrors.length > 0) {
      let message = 'Multiple errors occurred while adding files:\n'
      nonRestrictionErrors.forEach((subError) => {
        message += `\n * ${subError.message}`
      })
    // ? method is used to display informational messages to the user
    // ? this.info emits an `info-visible` event and calls hideInfo() which emits an `info-hidden` event
      this.info(
        {
          message: this.i18n('addBulkFilesFailed', {
            smart_count: nonRestrictionErrors.length,
          }),
          details: message,
        },
        'error',
        this.opts.infoTimeout,
      )

      if (typeof AggregateError === 'function') {
        throw new AggregateError(nonRestrictionErrors, message)
      } else {
        const err = new Error(message)
        // @ts-expect-error fallback when AggregateError is not available
        err.errors = nonRestrictionErrors
        throw err
      }
    }

    // OK, we haven't thrown an error, we can start updating state and emitting events now:

    this.setState({ files: nextFilesState })

    validFilesToAdd.forEach((file) => {
      this.emit('file-added', file)
    })

    this.emit('files-added', validFilesToAdd)

    if (validFilesToAdd.length > 5) {
      this.log(`Added batch of ${validFilesToAdd.length} files`)
    } else {
      Object.values(validFilesToAdd).forEach((file) => {
        this.log(
          `Added file: ${file.name}\n id: ${file.id}\n type: ${file.type}`,
        )
      })
    }

    if (validFilesToAdd.length > 0) {
      this.#startIfAutoProceed()
    }
  }


  // is responsible for removing one or more files from the Uppy instance.
  // This involves updating Uppy's internal state, handling associated uploads, and emitting relevant events.
  // ? Done but need to revisit
  removeFiles(fileIDs: string[]): void {
    const { files, currentUploads } = this.getState()
    // creates a shallow copy of the `files` and `currentUploads` objects
    // this copy will be modified to remove the specified files.
    const updatedFiles = { ...files }
    const updatedUploads = { ...currentUploads }

    // initializes an empty object that will store the file objects that are actually being removed.
    // this is used later for emitting events.
    const removedFiles = Object.create(null)

    // Iterate over the fileIDs checks if the file exists in existing state
    // and add the files to be removed to `removedFiles` object
    // and remove those files from `updatedFiles`.
    fileIDs.forEach((fileID) => {
      if (files[fileID]) {
        removedFiles[fileID] = files[fileID]
        // delete that file from the updatedFiles object
        delete updatedFiles[fileID]
      }
    })

    // It is a helper function used as a filter. It returns true if a given uploadFileID
    // is not in the removedFiles object i.e. it's not one of the files being removed.
    function fileIsNotRemoved(uploadFileID: string): boolean {
      return removedFiles[uploadFileID] === undefined
    }

    // Iterates over each ongoing or pending upload.
    Object.keys(updatedUploads).forEach((uploadID) => {
    // For each upload, it filters its list of associated fileIDs
    // keeping only those that are not being removed.
      const newFileIDs =
        currentUploads[uploadID].fileIDs.filter(fileIsNotRemoved)

      // If an upload becomes empty:
      // If all files associated with an upload have been removed, that upload itself is no longer relevant.
      if (newFileIDs.length === 0) {
        // hence delete the entire upload entry from `updatedUploads`.
        delete updatedUploads[uploadID]
        return
      }

      // get capabilities object from the current state
      const { capabilities } = this.getState()

      // If Some files were removed from an upload, but not all, so the upload still exists,
      // and The currently active uploader plugin does support individual file cancellation, with an ongoing batch
      if (
        newFileIDs.length !== currentUploads[uploadID].fileIDs.length &&
        !capabilities.individualCancellation
      ) {
        // then throw an error
        throw new Error(
          'The installed uploader plugin does not allow removing files during an upload.',
        )
      }

      // update the upload with remaining files
      // if the upload still has files and individual cancellation is allowed (or no files were part of an active
      // upload that disallows it), the upload entry in updatedUploads
      // is updated with the new filtered list of fileIDs.
      updatedUploads[uploadID] = {
        ...currentUploads[uploadID],
        fileIDs: newFileIDs,
      }
    })

    // update state with modified `updatedUploads` and `updatedFiles`
    const stateUpdate: Partial<State<M, B>> = {
      currentUploads: updatedUploads,
      files: updatedFiles,
    }

    // If all files were removed - allow new uploads,
    // and clear recoveredState
    if (Object.keys(updatedFiles).length === 0) {
      stateUpdate.allowNewUpload = true
      stateUpdate.error = null
      // Clears any state recovered by plugins like Golden Retriever.
      stateUpdate.recoveredState = null
    }

    this.setState(stateUpdate)
    //  Recalculates and updates the total upload progress (throttled to avoid excessive updates).
    this.#updateTotalProgressThrottled()


    // For each file that was removed, a 'file-removed' event is emitted, passing the full file object.
    // This allows plugins and UI components to react to the removal.
    const removedFileIDs = Object.keys(removedFiles)
    removedFileIDs.forEach((fileID) => {
      this.emit('file-removed', removedFiles[fileID])
    })

    if (removedFileIDs.length > 5) {
      this.log(`Removed ${removedFileIDs.length} files`)
    } else {
      this.log(`Removed files: ${removedFileIDs.join(', ')}`)
    }
  }

  // ? Done
  removeFile(fileID: string): void {
    this.removeFiles([fileID])
  }

  // ? Done
  pauseResume(fileID: string): boolean | undefined {
    if (
      !this.getState().capabilities.resumableUploads ||
      this.getFile(fileID).progress.uploadComplete
    ) {
      return undefined
    }

    const file = this.getFile(fileID)
    // `wasPaused` is a boolean that indicates whether the file was paused before this method was called.
    // if file.isPaused is undefined, it defaults to false.
    const wasPaused = file.isPaused || false
    // this is the core toggle logic if it was paused, it will be resumed, and vice versa
    const isPaused = !wasPaused

    // Update the file state with the new pause/resume status
    this.setFileState(fileID, {
      isPaused,
    })

    // ! this Emits an 'upload-pause' event, which is used to notify plugins that the upload has been paused or resumed.
    this.emit('upload-pause', file, isPaused)


    // return the new pause/resume status which was set in the file state
    return isPaused
  }

  // this method pauses all files that are in progress and not completed.
  // ? Done
  pauseAll(): void {
    // get shallow copy of the current files state
    const updatedFiles = { ...this.getState().files }

    // filter the files that are in progress and not completed
    const inProgressUpdatedFiles = Object.keys(updatedFiles).filter((file) => {
      // check if the file is in progress and not completed
      // i.e. uploadStarted is not null and uploadComplete is false
      return (
        !updatedFiles[file].progress.uploadComplete &&
        updatedFiles[file].progress.uploadStarted
      )
    })

    // for each file that is in progress, set its isPaused to true
    inProgressUpdatedFiles.forEach((file) => {

      // ? Question why aren't we setting the error to null here same as in resumeAll as seen below?
      const updatedFile = { ...updatedFiles[file], isPaused: true }
      // and add that file state to updatedFiles object
      updatedFiles[file] = updatedFile
    })

    // update the uppy files state with the updatedFiles object
    this.setState({ files: updatedFiles })

    // ! this Emits an 'upload-pause' event, which is used to notify plugins that the upload has been paused.
    this.emit('pause-all')
  }

  // This method resumes all files that are in progress and not completed.
  // ? Done
  resumeAll(): void {
    // get a shallow copy of the current files state
    const updatedFiles = { ...this.getState().files }

    // filter the files that are in progress and not completed
    const inProgressUpdatedFiles = Object.keys(updatedFiles).filter((file) => {
      // check if the file is in progress and not completed
      // i.e. uploadStarted is not null and uploadComplete is false
      return (
        !updatedFiles[file].progress.uploadComplete &&
        updatedFiles[file].progress.uploadStarted
      )
    })

    // for each file that is in progress, set its isPaused to false and error to null
    inProgressUpdatedFiles.forEach((file) => {
      const updatedFile = {
        ...updatedFiles[file],
        isPaused: false,
        error: null,
      }
      // and add that file state to updatedFiles object
      updatedFiles[file] = updatedFile
    })

    // update the uppy files state with the updatedFiles object
    this.setState({ files: updatedFiles })
    // ! this Emits an 'upload-resume' event, which is used to notify plugins that the upload has been resumed.
    this.emit('resume-all')
  }

  // This method returns an array containing only the IDs of the files that have an error.
  // ? Done
  #getFilesToRetry() {
    // get the current files state
    const { files } = this.getState()
    // filter the files that have an error
    return Object.keys(files).filter((file) => {
      return files[file].error
    })
  }

  // This method retries upload for all files that have an error.
  // ? Done
  async #doRetryAll(): Promise<UploadResult<M, B> | undefined> {
    // get the IDs of the files that have an error
    const filesToRetry = this.#getFilesToRetry()

    // create a shallow copy of the current files state
    const updatedFiles = { ...this.getState().files }

    // for each file that has an error, set its isPaused to false and error to null in file object
    filesToRetry.forEach((fileID) => {
      updatedFiles[fileID] = {
        ...updatedFiles[fileID],
        isPaused: false,
        error: null, // clear the error state of each individual file in files array
      }
    })

    // update the uppy state with updatedFiles object and set error to null in Uppy State
    this.setState({
      files: updatedFiles,
      error: null, // clear the global error state in Uppy State
    })

    // ! Emit an event 'retry-all' with the files that are being retried
    this.emit('retry-all', this.getFilesByIds(filesToRetry))

    // If there are no files to retry, return an empty UploadResult
    if (filesToRetry.length === 0) {
      return {
        successful: [],
        failed: [],
      }
    }

    // If there are files to retry, create a new upload with those files
    const uploadID = this.#createUpload(filesToRetry, {
      forceAllowNewUpload: true, // create new upload even if allowNewUpload: false
    })
    return this.#runUpload(uploadID)
  }

  // ? Done
  async retryAll(): Promise<UploadResult<M, B> | undefined> {
    const result = await this.#doRetryAll()
    // ! This emits a `complete` event with the result (result is upload result) from #doRetryAll -> #runUpload
    this.emit('complete', result!)
    return result
  }

  // ? Done
  cancelAll(): void {
    // ! This emits a `cancel-all` event.
    this.emit('cancel-all')

    // gets the files array from uppy state
    const { files } = this.getState()

    // creates an array of file IDs from the files object Keys
    const fileIDs = Object.keys(files)

    // if fileIDs array is not empty, it calls removeFiles method with fileIDs array
    if (fileIDs.length) {
      this.removeFiles(fileIDs)
    }
    // resets the the upload state to it's default values
    this.setState(defaultUploadState)
  }

  // ? Done
  // Retries upload for a specific file by its ID.
  retryUpload(fileID: string): Promise<UploadResult<M, B> | undefined> {
    this.setFileState(fileID, {
      error: null,
      isPaused: false,
    })
    // ! This emits an `upload-retry` event with the file object that is being retried.
    this.emit('upload-retry', this.getFile(fileID))

    const uploadID = this.#createUpload([fileID], {
      forceAllowNewUpload: true, // create new upload even if allowNewUpload: false
    })
    return this.#runUpload(uploadID)
  }

// ? Done
  logout(): void {
    this.iteratePlugins((plugin) => {
      ;(plugin as UnknownProviderPlugin<M, B>).provider?.logout?.()
    })
  }

//  * Done but need to revisit
  #handleUploadProgress = (
    file: UppyFile<M, B> | undefined,
    progress: FileProgressStarted,
  ) => {
    // get the latest file state from the store , because the file state which has been passed in the params
    // might be slightly old , so get the latest file state from the store
    const fileInState = file ? this.getFile(file.id) : undefined

    // if the file is not in state or has been removed, we don't set progress
    // we just log a message and return
    if (file == null || !fileInState) {
      this.log(
        `Not setting progress for a file that has been removed: ${file?.id}`,
      )
      return
    }

    // if the file in uppy's state has already been uploaded, we don't set progress
    // just log a message and return
    if (fileInState.progress.percentage === 100) {
      this.log(
        `Not setting progress for a file that has been already uploaded: ${file.id}`,
      )
      return
    }

    // calculate new progress
    const newProgress = {
      bytesTotal: progress.bytesTotal,
      // bytesTotal may be null or zero; in that case we can't divide by it
      percentage:
      // check if bytesTotal is a valid positive number only then calculate percentage
      // if bytesTotal is null or zero, percentage will be undefined
        (
          progress.bytesTotal != null &&
          Number.isFinite(progress.bytesTotal) &&
          progress.bytesTotal > 0
        ) ?
          Math.round((progress.bytesUploaded / progress.bytesTotal) * 100)
        : undefined,
    }

    // if the file upload has started (timestamp is already set in the file's progress. uploadStarted is typically
    // set by the 'upload-start' event handler), update the file state with
    // progress with newProgress (percentage and bytesTotal) calculated above

    // If uploadStarted is set, it means the upload is truly in progress, and it's safe to update
    // bytesUploaded with the value from the current progress event.

    if (fileInState.progress.uploadStarted != null) {
      this.setFileState(file.id, {
        progress: {
          ...fileInState.progress,
          ...newProgress,
          bytesUploaded: progress.bytesUploaded,
        },
      })
    } else {

    // If uploadStarted is null, it might mean this progress event is arriving before the formal 'upload-start' event
    // was processed for this file, or it's a progress event for a pre-processing step. In this case, it only updates
    // bytesTotal and percentage from newProgress but not bytesUploaded.
    // The bytesUploaded is initialized to 0 when uploadStarted is set.
      this.setFileState(file.id, {
        progress: {
          ...fileInState.progress,
          ...newProgress,
        },
      })
    }

    this.#updateTotalProgressThrottled()
  }

  // ? Done
  #updateTotalProgress() {
    // returns a number between 0 and 1, or 0.
    const totalProgress = this.#calculateTotalProgress()
    let totalProgressPercent: number | null = null
    if (totalProgress != null) {
      totalProgressPercent = Math.round(totalProgress * 100)
      if (totalProgressPercent > 100) totalProgressPercent = 100
      else if (totalProgressPercent < 0) totalProgressPercent = 0
    }

    // ! This emits a `progress` event with the total progress percentage. or 0 if totalProgressPercent is null
    this.emit('progress', totalProgressPercent ?? 0)
    this.setState({
      totalProgress: totalProgressPercent ?? 0,
    })
  }

  // ___Why throttle at 500ms?
  //    - We must throttle at >250ms for superfocus in Dashboard to work well
  //    (because animation takes 0.25s, and we want to wait for all animations to be over before refocusing).
  //    [Practical Check]: if thottle is at 100ms, then if you are uploading a file,
  //    and click 'ADD MORE FILES', - focus won't activate in Firefox.
  //    - We must throttle at around >500ms to avoid performance lags.
  //    [Practical Check] Firefox, try to upload a big file for a prolonged period of time. Laptop will start to heat up.
  // ? Prakash's Question: test this by yourself and figure out the reason for throttling
  #updateTotalProgressThrottled = throttle(
    () => this.#updateTotalProgress(),
    500,
    { leading: true, trailing: true },
  )

  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/explicit-module-boundary-types
  private [Symbol.for('uppy test: updateTotalProgress')]() {
    return this.#updateTotalProgress()
  }

  // ? Done
  #calculateTotalProgress() {
    // calculate total progress, using the number of files currently uploading,
    // between 0 and 1 and sum of individual progress of each file

    const files = this.getFiles()

    // note: also includes files that have completed uploading:
    const filesInProgress = files.filter((file) => {
      return (
        file.progress.uploadStarted ||
        file.progress.preprocess ||
        file.progress.postprocess
      )
    })

    if (filesInProgress.length === 0) {
      return 0
    }

    if (filesInProgress.every((file) => file.progress.uploadComplete)) {
      // If every uploading file is complete, and we're still getting progress, it probably means
      // there's a bug somewhere in some progress reporting code (maybe not even our code)
      // and we're still getting progress, so let's just assume it means a 100% progress
      return 1
    }

    // file whose total bytes is not null and not zero (bytes total is the file size in bytes)
    // if file which is of 0 bytes is added it will not be considered as sized file
    // can be consisdered as sized file
    const isSizedFile = (file: UppyFile<M, B>) =>
      file.progress.bytesTotal != null && file.progress.bytesTotal !== 0

    // filter files in progress into two categories: sized and unsized
    const sizedFilesInProgress = filesInProgress.filter(isSizedFile)

    // meaning these files have 0 bytes size and their progress is started
    const unsizedFilesInProgress = filesInProgress.filter(
      (file) => !isSizedFile(file),
    )

    if (
      sizedFilesInProgress.every((file) => file.progress.uploadComplete) &&
      unsizedFilesInProgress.length > 0 &&
      !unsizedFilesInProgress.every((file) => file.progress.uploadComplete)
    ) {
      // we are done with uploading all files of known size, however
      // there is at least one file with unknown size still uploading,
      // and we cannot say anything about their progress
      // In any case, return null because it doesn't make any sense to show a progress
      return null
    }

    // calculate total size of all the sizedFiles which are in progress
    const totalFilesSize = sizedFilesInProgress.reduce(
      // ? Prakash's comment: what is the purpose of falling back to 0 here ?
      // ? as sizedFile.progress.bytesTotal can never be 0
      (acc, file) => acc + (file.progress.bytesTotal ?? 0),
      0,
    )

    // calcualte total uploaded size of all the sizedFiles which are in progress
    const totalUploadedSize = sizedFilesInProgress.reduce(
      (acc, file) => acc + (file.progress.bytesUploaded || 0),
      0,
    )

    // if totalFilesSize is 0, return total progress as 0
    // this can happen if all files are of 0 bytes size
    // else return totalUploadedSize / totalFilesSize
    // this will return a value between 0 and 1
    return totalFilesSize === 0 ? 0 : totalUploadedSize / totalFilesSize
  }

  /**
   * Registers listeners for all global actions, like:
   * `error`, `file-removed`, `upload-progress`
   */
  #addListeners(): void {
    // Type inference only works for inline functions so we have to type it again


    // the above line means if we had described the listener inline, TypeScript would have inferred the type
    // without having to explicitly type it again.
    /*
    this.on('error', (err, file, response) => {
    here typecript would have inferred the type of `err` as `UppyEventMap<M, B>['error']`
    */
  //  but since the reason we defined it as a seaparte function is to
  // is so that it can be reused in upload-error event handler
  // as errorHandler performs the basic state updates which are also
  // required in the case of upload-error , if this was added as inline
  // then the same logic inside errorHandler would have been duplicated
  // twice in case of error and upload-error events
  // ? Done
  const errorHandler: UppyEventMap<M, B>['error'] = (
      error,
      file,
      response,
    ) => {
      let errorMsg = error.message || 'Unknown error'
      if (error.details) {
        errorMsg += ` ${error.details}`
      }

      this.setState({ error: errorMsg })

      if (file != null && file.id in this.getState().files) {
        this.setFileState(file.id, {
          error: errorMsg,
          response,
        })
      }
    }

    this.on('error', errorHandler)
    // ? Done
    this.on('upload-error', (file, error, response) => {
      // errorHandler does the basic state updates , like setting error message
      // to state and set error message to file state
      errorHandler(error, file, response)
/*
Then, it proceeds with additional logic specific to upload errors:
It logs the original error message.
It creates a new, more user-friendly Error object using this.i18n to provide a localized "Failed to upload..." message.
It marks this new error as isUserFacing.
It potentially adds more details to this new error.
Finally, it uses this.#informAndEmit to display
this user-facing error (e.g., as a toast notification via the Informer plugin).
*/
      if (typeof error === 'object' && error.message) {
        this.log(error.message, 'error')
        const newError = new Error(
          this.i18n('failedToUpload', { file: file?.name ?? '' }),
        ) as any // we may want a new custom error here
        newError.isUserFacing = true // todo maybe don't do this with all errors?
        newError.details = error.message
        if (error.details) {
          newError.details += ` ${error.details}`
        }
        //! inside informAndEmit either `restriction-failed` or `error` event is emitted
        //! depending on the error.isRestriction flag
        this.#informAndEmit([newError])
      } else {
        this.#informAndEmit([error])
      }
    })

    let uploadStalledWarningRecentlyEmitted: ReturnType<
      typeof setTimeout
    > | null = null
    this.on('upload-stalled', (error, files) => {
      const { message } = error
      const details = files.map((file) => file.meta.name).join(', ')
      if (!uploadStalledWarningRecentlyEmitted) {
        // ! this.info() emits an `info-visible` event
        // ! and calls hideInfo() which emits an `info-hidden` event
        this.info({ message, details }, 'warning', this.opts.infoTimeout)

// the warning message is displayed, this line sets the uploadStalledWarningRecentlyEmitted flag.
// It uses setTimeout to schedule a function that will reset uploadStalledWarningRecentlyEmitted back
// to null after this.opts.infoTimeout milliseconds.
// This ensures that another "upload stalled" UI warning will not be shown until this timeout period has
// elapsed, even if more upload-stalled events are received in the meantime.

        uploadStalledWarningRecentlyEmitted = setTimeout(() => {
          uploadStalledWarningRecentlyEmitted = null
        }, this.opts.infoTimeout)
      }
      this.log(`${message} ${details}`.trim(), 'warning')
    })


// this.setState({ error: null }): It clears any global error message from Uppy's state.
// This is a good practice to ensure that a new upload attempt starts with a clean slate,
// removing any error messages from previous failed attempts.
    this.on('upload', () => {
      this.setState({ error: null })
    })

    const onUploadStarted = (files: UppyFile<M, B>[]): void => {
      // filter files by checking whether they actually exist in the state
      // this is is a safety check , as the file might have been removed
      // by the user between the time the upload was queued and when it
      // actually starts. if it doesn't exist, we log a message and don't update the progress.
      const filesFiltered = files.filter((file) => {
        const exists = file != null && this.getFile(file.id)
        if (!exists)
          this.log(
            `Not setting progress for a file that has been removed: ${file?.id}`,
          )
        return exists
      })

      // if files exists, we proceed to set their initial upload progress state
      const filesState = Object.fromEntries(
        filesFiltered.map((file) => [
          file.id,
          {
            progress: {
              uploadStarted: Date.now(), // set the upload started timestamp
              uploadComplete: false,
              bytesUploaded: 0,
              bytesTotal: file.size,
            } as FileProgressStarted,
          },
        ]),
      )

      // set the updated files state in uppy's state
      this.patchFilesState(filesState)
    }


// eslint-disable-next-line max-len
// this.on('upload-start', onUploadStarted) ([packages/@uppy/core/src/Uppy.ts:2006-2029][packages/@uppy/core/src/Uppy.ts]Uppy.ts ) ))

// Event: 'upload-start' ([packages/@uppy/core/src/Uppy.ts:363-365][packages/@uppy/core/src/Uppy.ts]Uppy.ts ) ))

// eslint-disable-next-line max-len
// Triggered By: Typically emitted by uploader plugins (like Tus, XHRUpload) just before they begin the actual transmission of a batch of files. For example, in @uppy/tus it's emitted in #handleUpload ([packages/@uppy/tus/src/index.ts:528-532][packages/@uppy/tus/src/index.ts]index.ts ) )).


    this.on('upload-start', onUploadStarted)

    this.on('upload-progress', this.#handleUploadProgress)

    this.on('upload-success', (file, uploadResp) => {
      if (file == null || !this.getFile(file.id)) {
        this.log(
          `Not setting progress for a file that has been removed: ${file?.id}`,
        )
        return
      }

      const currentProgress = this.getFile(file.id).progress
      this.setFileState(file.id, {
        progress: {
          ...currentProgress,
          postprocess:
            this.#postProcessors.size > 0 ?
              {
                mode: 'indeterminate',
              }
            : undefined,
          uploadComplete: true,
          percentage: 100,
          bytesUploaded: currentProgress.bytesTotal,
        } as FileProgressStarted,
        response: uploadResp,
        uploadURL: uploadResp.uploadURL,
        isPaused: false,
      })

      // Remote providers sometimes don't tell us the file size,
      // but we can know how many bytes we uploaded once the upload is complete.
      if (file.size == null) {
        this.setFileState(file.id, {
          size: uploadResp.bytesUploaded || currentProgress.bytesTotal,
        })
      }

      this.#updateTotalProgressThrottled()
    })
// Triggered By: Emitted by pre-processor plugins
// (e.g., ThumbnailGenerator ([packages/@uppy/thumbnail-generator/src/index.ts:415-424]
// [packages/@uppy/thumbnail-generator/src/index.ts]index.ts ) ))) to report progress on their tasks.

    this.on('preprocess-progress', (file, progress) => {
      // Ensures the file hasn't been removed.
      if (file == null || !this.getFile(file.id)) {
        this.log(
          `Not setting progress for a file that has been removed: ${file?.id}`,
        )
        return
      }
      // Updates the preprocess property within the file's progress object with the new progress information.
      this.setFileState(file.id, {
        progress: { ...this.getFile(file.id).progress, preprocess: progress },
      })
    })

    // Triggered By: Emitted by pre-processor plugins when they have finished their task for a file.
    this.on('preprocess-complete', (file) => {
      // Ensures the file hasn't been removed.
      if (file == null || !this.getFile(file.id)) {
        this.log(
          `Not setting progress for a file that has been removed: ${file?.id}`,
        )
        return
      }
      const files = { ...this.getState().files }
      // This creates a copy of the files state, then a copy of the specific file's state,
      // and then a copy of that file's progress state.
      files[file.id] = {
        ...files[file.id],
        progress: { ...files[file.id].progress },
      }
      // delete files[file.id].progress.preprocess: Removes the preprocess property
      // from the file's progress object, signifying that pre-processing is done.
      delete files[file.id].progress.preprocess

      // update uppy's state with the modified files object
      this.setState({ files })
    })
// eslint-disable-next-line max-len
// Emitted by post-processor plugins (e.g., Transloadit ([packages/@uppy/transloadit/src/index.ts:759-775][packages/@uppy/transloadit/src/index.ts]index.ts ) ))) to report progress on their tasks after a file upload.
    this.on('postprocess-progress', (file, progress) => {
      // Ensures the file hasn't been removed.
      if (file == null || !this.getFile(file.id)) {
        this.log(
          `Not setting progress for a file that has been removed: ${file?.id}`,
        )
        return
      }
      // Updates the postprocess property within the file's progress object with the new progress information.
      this.setFileState(file.id, {
        progress: {
          ...this.getState().files[file.id].progress,
          postprocess: progress,
        },
      })
    })
// Triggered By: Emitted by post-processor plugins when they have finished their task.
// Also emitted inside #runUpload as a fallback if post-processors don't emit it themselves.
    this.on('postprocess-complete', (file) => {
      if (file == null || !this.getFile(file.id)) {
        // Ensures the file hasn't been removed.
        this.log(
          `Not setting progress for a file that has been removed: ${file?.id}`,
        )
        return
      }
      // Creates a copy of the files state, then a copy of the specific file's state,
      // and then a copy of that file's progress state.
      const files = {
        ...this.getState().files,
      }
      // deletes the postprocess property from the file's progress object,
      // signifying that post-processing is done.
      files[file.id] = {
        ...files[file.id],
        progress: {
          ...files[file.id].progress,
        },
      }
      delete files[file.id].progress.postprocess

      // update uppy's state with the modified files object
      this.setState({ files })
    })


    // eslint-disable-next-line max-len
    // Emitted by plugins like Golden Retriever ([packages/@uppy/golden-retriever/src/index.ts:278-294][packages/@uppy/golden-retriever/src/index.ts]index.ts ) )
    // after successfully restoring files and their states (e.g., after a browser crash or tab close).
    this.on('restored', () => {
      // Files may have changed--ensure progress is still accurate.

      // ? Prakash's Comment: Recalculates and updates the total progress. This is important because
      // ? the restored files might have different progress states, or some files might not have been
      // ? restored, affecting the overall progress.
      this.#updateTotalProgressThrottled()
    })

    // @ts-expect-error should fix itself when dashboard it typed (also this doesn't belong here)
    // Triggered By: Emitted by a UI plugin (like Dashboard) after a user finishes editing a file's metadata.
    this.on('dashboard:file-edit-complete', (file) => {
      if (file) {
        // This method validates if all required metadata fields (defined in Uppy's restrictions)
        // are present for the edited file. If not, it might set an error on the file or emit a restriction-failed event.
        this.#checkRequiredMetaFieldsOnFile(file)
      }
    })

    // show informer if offline
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', this.#updateOnlineStatus)
      window.addEventListener('offline', this.#updateOnlineStatus)
      setTimeout(this.#updateOnlineStatus, 3000)
    }
  }

  // ? Done
  updateOnlineStatus(): void {
    const online = window.navigator.onLine ?? true
    if (!online) {
      // ! this emits an `is-offline` event
      this.emit('is-offline')
      this.info(this.i18n('noInternetConnection'), 'error', 0)
      this.wasOffline = true
    } else {
      // ! this emits an `is-online` event
      this.emit('is-online')
      if (this.wasOffline) {
        // ! this emits a `back-online` event
        this.emit('back-online')
        this.info(this.i18n('connectedToInternet'), 'success', 3000)
        this.wasOffline = false
      }
    }
  }

  // This pattern is used to ensure that when updateOnlineStatus is used as an event
  // handler for browser events (like online and offline), the this context inside updateOnlineStatus
  // correctly refers to the Uppy instance.
  #updateOnlineStatus = this.updateOnlineStatus.bind(this)

  // ? Done
  getID(): string {
    return this.opts.id
  }

  /**
   * Registers a plugin with Core.
   */

  // The use method is  how you add and register plugins with an Uppy instance.
  // Plugins extend Uppy's functionality, providing features like UI elements (e.g., Dashboard),
  // upload sources (e.g., Webcam, GoogleDrive), or uploaders (e.g., Tus, XHRUpload).
  use<T extends typeof BasePlugin<any, M, B>>(
    Plugin: T,
    // We want to let the plugin decide whether `opts` is optional or not
    // so we spread the argument rather than defining `opts:` ourselves.
    // ? Prakash's Comments:
    //  removes the first parameter type from that list. The first parameter of a plugin's constructor
    // is always the Uppy instance itself (this), which is passed implicitly later.
    ...args: OmitFirstArg<ConstructorParameters<T>>
  ): this {
    // check if it's a valid plugin
    if (typeof Plugin !== 'function') {
      const msg =
        `Expected a plugin class, but got ${
          Plugin === null ? 'null' : typeof Plugin
        }.` +
        ' Please verify that the plugin was imported and spelled correctly.'
      throw new TypeError(msg)
    }

    // Instantiate the plugin with `this` as the Uppy instance and the provided arguments.
    const plugin = new Plugin(this, ...args)
    const pluginId = plugin.id

    if (!pluginId) {
      throw new Error('Your plugin must have an id')
    }

    // Plugins also need a type property (e.g., 'acquirer', 'uploader',
    // 'orchestrator', 'presenter', 'modifier', 'progressindicator'). If missing, an error is thrown.
    // This type helps Uppy categorize and manage plugins.
    if (!plugin.type) {
      throw new Error('Your plugin must have a type')
    }

    // this.getPlugin(pluginId) is called to check if a plugin with the same ID has already been registered.
    const existsPluginAlready = this.getPlugin(pluginId)
    if (existsPluginAlready) {
      const msg =
        `Already found a plugin named '${existsPluginAlready.id}'. ` +
        `Tried to use: '${pluginId}'.\n` +
        'Uppy plugins must have unique `id` options.'
      throw new Error(msg)
    }

    // @ts-expect-error does exist
    if (Plugin.VERSION) {
      // @ts-expect-error does exist
      this.log(`Using ${pluginId} v${Plugin.VERSION}`)
    }

    if (plugin.type in this.#plugins) {
      // if that type already exists in this.#plugins, we push the new plugin to that type's array
      this.#plugins[plugin.type].push(plugin)
    } else {
      // if that type does not exist in this.#plugins, we create a new array with the new plugin
      this.#plugins[plugin.type] = [plugin]
    }
    // Each plugin is expected to have an install() method (See BasePlugin class).
    // This method is where the plugin typically sets up its event listeners, modifies
    // Uppy's state if needed, or prepares its UI.
    plugin.install()

    // ! This emits a `plugin-added` event with the plugin instance.
    this.emit('plugin-added', plugin)

    return this
  }

  /**
   * Find one Plugin by name.
   */
  // ? Done
  getPlugin<T extends UnknownPlugin<M, B> = UnknownPlugin<M, B>>(
    id: string,
  ): T | undefined {
    for (const plugins of Object.values(this.#plugins)) {
      const foundPlugin = plugins.find((plugin) => plugin.id === id)
      if (foundPlugin != null) return foundPlugin as T
    }
    return undefined
  }

  private [Symbol.for('uppy test: getPlugins')](
    type: string,
  ): UnknownPlugin<M, B>[] {
    return this.#plugins[type]
  }

  /**
   * Iterate through all `use`d plugins.
   *
   */
  // ? Done
  iteratePlugins(method: (plugin: UnknownPlugin<M, B>) => void): void {
    Object.values(this.#plugins).flat(1).forEach(method)
  }

  /**
   * Uninstall and remove a plugin.
   *
   * @param {object} instance The plugin instance to remove.
   */
  removePlugin(instance: UnknownPlugin<M, B>): void {
    this.log(`Removing plugin ${instance.id}`)
    this.emit('plugin-remove', instance)

    if (instance.uninstall) {
      instance.uninstall()
    }

    const list = this.#plugins[instance.type]
    // list.indexOf failed here, because Vue3 converted the plugin instance
    // to a Proxy object, which failed the strict comparison test:
    // obj !== objProxy
    const index = list.findIndex((item) => item.id === instance.id)
    if (index !== -1) {
      list.splice(index, 1)
    }

    const state = this.getState()
    const updatedState = {
      plugins: {
        ...state.plugins,
        [instance.id]: undefined,
      },
    }
    this.setState(updatedState)
  }

  /**
   * Uninstall all plugins and close down this Uppy instance.
   */
  // ? Done
  destroy(): void {
    this.log(
      `Closing Uppy instance ${this.opts.id}: removing all files and uninstalling plugins`,
    )

    this.cancelAll()

    this.#storeUnsubscribe()

    this.iteratePlugins((plugin) => {
      this.removePlugin(plugin)
    })

    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('online', this.#updateOnlineStatus)
      window.removeEventListener('offline', this.#updateOnlineStatus)
    }
  }

  /**
   * is responsible for removing the oldest informational message from the queue of messages displayed to the user.
   * Emits `info-hidden` event.
   * `info-hidden` event signals to other parts of the Uppy system or plugins that
   * an informational message has just been hidden. , this could be used for logging, analytics, or other custom behaviors.
   */
  // ? Done
  hideInfo(): void {
    const { info } = this.getState()

    this.setState({ info: info.slice(1) })

    this.emit('info-hidden')
  }

  /**
   * this.info() method is used to display informational messages to the user
   * often through a UI plugin like @uppy/informer which renders them as toast
   * like notifications.
   * Summary of this.info() method:
   * - Adds a new informational message (with its type, content, and details) to Uppy's central state.
   * - Sets a timer (default duration 3000) to automatically hide this message after a specified duration.
   * - Emits an event to notify that a new info message is visible.
   */
  // ? done
  info(
    message:
      | string
      | { message: string; details?: string | Record<string, string> },
    type: LogLevel = 'info',
    duration = 3000,
  ): void {
    const isComplexMessage = typeof message === 'object'

    // udpate state with new info message
    this.setState({
      info: [
        ...this.getState().info,
        {
          type,
          message: isComplexMessage ? message.message : message,
          details: isComplexMessage ? message.details : null,
        },
      ],
    })

    //! inside hideInfo() `info-hidden` is emmitted
    setTimeout(() => this.hideInfo(), duration)

    this.emit('info-visible')
  }

  /**
   * Passes messages to a function, provided in `opts.logger`.
   * If `opts.logger: Uppy.debugLogger` or `opts.debug: true`, logs to the browser console.
   */

  // ? Done
  log(message: unknown, type?: 'error' | 'warning'): void {
    const { logger } = this.opts
    switch (type) {
      case 'error':
        logger.error(message)
        break
      case 'warning':
        logger.warn(message)
        break
      default:
        logger.debug(message)
        break
    }
  }

  // We need to store request clients by a unique ID, so we can share RequestClient instances across files
  // this allows us to do rate limiting and synchronous operations like refreshing provider tokens
  // example: refreshing tokens: if each file has their own requestclient,
  // we don't have any way to synchronize all requests in order to
  // - block all requests
  // - refresh the token
  // - unblock all requests and allow them to run with a the new access token
  // back when we had a requestclient per file, once an access token expired,
  // all 6 files would go ahead and refresh the token at the same time
  // (calling /refresh-token up to 6 times), which will probably fail for some providers
  #requestClientById = new Map<string, unknown>()


  // ? Done
  registerRequestClient(id: string, client: unknown): void {
    this.#requestClientById.set(id, client)
  }

  /** @protected */
  getRequestClientForFile<Client>(file: UppyFile<M, B>): Client {
    // This is the first check. file.remote is an object containing details if the file
    //  originates from a remote source (like Google Drive, Instagram, etc., usually via Uppy Companion).
    // If file.remote is falsy (i.e., undefined or null), it means the file is not a remote file (it's likely a
    // local file selected by the user).
    // Request clients are typically only relevant for remote files. So, if it's not a remote file,
    // the method throws an error because it doesn't make sense to ask for a request client for a local file in this context.

    if (!file.remote)
      throw new Error(
        `Tried to get RequestClient for a non-remote file ${file.id}`,
      )
    const requestClient = this.#requestClientById.get(
      file.remote.requestClientId,
    )
    if (requestClient == null)
      throw new Error(
        `requestClientId "${file.remote.requestClientId}" not registered for file "${file.id}"`,
      )
    return requestClient as Client
  }

  /**
   * Restore an upload by its ID.
   */
  // ? Done but with questions
  restore(uploadID: string): Promise<UploadResult<M, B> | undefined> {
    this.log(`Core: attempting to restore upload "${uploadID}"`)

    // ? Question: if that upload ID does not exist in currentUploads,
    // ? then what's the point of calling #removeUpload(uploadID) ?
    // ? as remove upload will attempt to remove that upload from currentUploads
    // ? based on the uploadID.
    if (!this.getState().currentUploads[uploadID]) {
      this.#removeUpload(uploadID)
      return Promise.reject(new Error('Nonexistent upload'))
    }

    return this.#runUpload(uploadID)
  }

  /**
   * Create an upload for a bunch of files.
   *
   */
  #createUpload(
    fileIDs: string[],
    opts: { forceAllowNewUpload?: boolean } = {},
  ): string {
    // uppy.retryAll sets this to true — when retrying we want to ignore `allowNewUpload: false`
    const { forceAllowNewUpload = false } = opts

    const { allowNewUpload, currentUploads } = this.getState()
    if (!allowNewUpload && !forceAllowNewUpload) {
      throw new Error('Cannot create a new upload: already uploading.')
    }

    const uploadID = nanoid()

    //! This emits an upload event
    this.emit('upload', uploadID, this.getFilesByIds(fileIDs))

    this.setState({
      allowNewUpload:
        this.opts.allowMultipleUploadBatches !== false &&
        this.opts.allowMultipleUploads !== false,

      currentUploads: {
        ...currentUploads,
        [uploadID]: {
          fileIDs,
          step: 0,
          result: {},
        },
      },
    })

    return uploadID
  }

  private [Symbol.for('uppy test: createUpload')](...args: any[]): string {
    // @ts-expect-error https://github.com/microsoft/TypeScript/issues/47595
    return this.#createUpload(...args)
  }

  // ? Done
  #getUpload(uploadID: string): CurrentUpload<M, B> {
    const { currentUploads } = this.getState()

    return currentUploads[uploadID]
  }

  /**
   * Add data to an upload's result object.
   */
  // ? Done
  addResultData(uploadID: string, data: CurrentUpload<M, B>['result']): void {
    if (!this.#getUpload(uploadID)) {
      this.log(
        `Not setting result for an upload that has been removed: ${uploadID}`,
      )
      return
    }
    // get the currentUploads from uppy State
    const { currentUploads } = this.getState()

    // create a new currentUpload object by spreading the old and adding the new data i.e. result
    // inside result spread the old result and spread the new data so that it get's updated
    const currentUpload = {
      ...currentUploads[uploadID],
      result: { ...currentUploads[uploadID].result, ...data },
    }

    // update the uppy state with latest currentUpload object ,
    // spread the old currentUploads and add the new updated one with the specific uploadID
    this.setState({
      currentUploads: { ...currentUploads, [uploadID]: currentUpload },
    })
  }

  /**
   * Remove an upload, eg. if it has been canceled or completed.
   *
   */
  // ? Done
  #removeUpload(uploadID: string): void {
    const currentUploads = { ...this.getState().currentUploads }
    delete currentUploads[uploadID]

    this.setState({
      currentUploads,
    })
  }

  /**
   * Run an upload. This picks up where it left off in case the upload is being restored.
   */
  // * Done but need to revisit
  async #runUpload(uploadID: string): Promise<UploadResult<M, B> | undefined> {

    // get current upload from the uppy state based on the uploadID which was passed in #runUpload
    // this function's purpose is to get the latest current upload object from uppy state
    // This is important because other parts of Uppy (or plugins) might modify the state of this upload asynchronously
    // while #runUpload is executing.
    const getCurrentUpload = (): CurrentUpload<M, B> => {
      const { currentUploads } = this.getState()
      return currentUploads[uploadID]
    }

    // get the current upload object
    let currentUpload = getCurrentUpload()

    // Define Processing steps

/*
**  Uppy's upload process is divided into three main phases:
  - this.#preProcessors: An array of functions (plugins) that run before the actual upload
    (e.g., image compression, metadata extraction).
  - this.#uploaders: An array of functions (uploader plugins like Tus, XHRUpload, AwsS3) that
  handle the actual file transfer.
  - this.#postProcessors: An array of functions (plugins) that run after the upload is complete
  (e.g., server-side processing notifications, cleanup).
*/
// the `steps` array concatenates all registered functions from these three phases
// into a single ordered list
    const steps = [
      ...this.#preProcessors,
      ...this.#uploaders,
      ...this.#postProcessors,
    ]

    /*
    The loop iterates from current step of the upload (currentUpload.step , defaulting to 0 if not set)
    through all the defined steps. This allows resuming from a specific step if the upload was previously interrupted.
    */

    try {
      for (let step = currentUpload.step || 0; step < steps.length; step++) {
        if (!currentUpload) {
          break
        }
        const fn = steps[step]

        // Before executing the step, Uppy updates it's central state to reflect that
        // this uploadId is now at the current step. This is crucial for resumability and
        // for UI to reflect the current step.
        // update currentUpload step in state.
        this.setState({
          currentUploads: {
            ...this.getState().currentUploads,
            [uploadID]: {
              ...currentUpload,
              step,
            },
          },
        })

        // gets the list of file IDs that are associated with this the upload batch
        const { fileIDs } = currentUpload

        // TODO give this the `updatedUpload` object as its only parameter maybe?
        // Otherwise when more metadata may be added to the upload this would keep getting more parameters
        // executing the actual step function
        await fn(fileIDs, uploadID)

        // Update currentUpload value in case it was modified asynchronously.
        currentUpload = getCurrentUpload()
      }
    } catch (err) {
      this.#removeUpload(uploadID)
      throw err
    }



    // This block executes only if currentUpload still exists
    // (i.e., the upload wasn't cancelled or removed due to an error during the steps).
    // Set result data.
    if (currentUpload) {
      // Mark postprocessing step as complete if necessary; this addresses a case where we might get
      // stuck in the postprocessing UI while the upload is fully complete.
      // If the postprocessing steps do not do any work, they may not emit postprocessing events at
      // all, and never mark the postprocessing as complete. This is fine on its own but we
      // introduced code in the @uppy/core upload-success handler to prepare postprocessing progress
      // state if any postprocessors are registered. That is to avoid a "flash of completed state"
      // before the postprocessing plugins can emit events.
      //
      // So, just in case an upload with postprocessing plugins *has* completed *without* emitting
      // postprocessing completion, we do it instead.


//! Prakash's Comments

// Sometimes, post-processing plugins might not emit progress or completion events if they don't do significant work.
// To prevent the UI from getting stuck in a "post-processing" state, Uppy manually emits 'postprocess-complete' for any file
// in the batch that still has a progress.postprocess state.

      currentUpload.fileIDs.forEach((fileID) => {
        const file = this.getFile(fileID)
        if (file && file.progress.postprocess) {
          this.emit('postprocess-complete', file)
        }
      })

      //  Retrieves the full file objects for the current upload (just to referesh -- current upload is the uploadObject
      // based on the uploadId provided in #runUpload method).
      const files = currentUpload.fileIDs.map((fileID) => this.getFile(fileID))

      // Filter out files that don't have error
      const successful = files.filter((file) => !file.error)

      // Filter out files that have error
      const failed = files.filter((file) => file.error)

      // The lists of successful and failed files, along with the uploadId, are
      // added to the result field of this currentUpload object in uppy state.
      this.addResultData(uploadID, { successful, failed, uploadID })

      // Update currentUpload value in case it was modified asynchronously.
      currentUpload = getCurrentUpload()
    }
    // Emit completion events.
    // This is in a separate function so that the `currentUploads` variable
    // always refers to the latest state. In the handler right above it refers
    // to an outdated object without the `.result` property.
    let result

    // The upload batch, having completed its lifecycle, is now removed from the currentUploads
    // in the state. This signifies that this particular upload operation is finished.
    if (currentUpload) {
      result = currentUpload.result
      this.#removeUpload(uploadID)
    }
    // If result is Still Null (Upload Removed Concurrently):
    // if (result == null): This condition handles cases where currentUpload might
    // have been removed from the state by another process after the main loop but before
    // this final block, or if it was removed due to an error and the catch block was somehow
    // bypassed (less likely).
    if (result == null) {
      this.log(
        `Not setting result for an upload that has been removed: ${uploadID}`,
      )
      result = {
        successful: [],
        failed: [],
        uploadID,
      }
    }
    return result
  }

  /**
   * Start an upload for all the files that are not currently being uploaded.
   */
  async upload(): Promise<NonNullable<UploadResult<M, B>> | undefined> {
    // it checks if any plugins of type 'uploader' example XHR , TUS are registered. with uppy
    // if no uploader plugins are found it logs a warning message , upload might still proceed
    // through pre / post processors but won't transfer files.
    if (!this.#plugins['uploader']?.length) {
      this.log('No uploader type plugins are used', 'warning')
    }

// It retrieves the current map of all files ({ [fileID]: UppyFile }) from Uppy's state.
// This files variable might be updated later by the onBeforeUpload hook.
    let { files } = this.getState()

    // retry any failed files from a previous upload() call
    const filesToRetry = this.#getFilesToRetry()
    if (filesToRetry.length > 0) {
      // #doRetryAll resets the error and pause status for these files, emits a 'retry-all' event
      // creates a new upload batch for them, and runs it using #runUpload.
      const retryResult = await this.#doRetryAll() // we don't want the complete event to fire
      // It then checks if there are any other files in Uppy that haven't started uploading yet
      // (i.e., new files added since the last attempt or files that were never part of the failed batch).
      const hasNewFiles =
        this.getFiles().filter((file) => file.progress.uploadStarted == null)
          .length > 0

      // if no new files, make it idempotent and return
      if (!hasNewFiles) {
        // ! this emits a `complete` event with the retryResult
        this.emit('complete', retryResult!)
        return retryResult
      }
      // If there are new files in addition to the retried ones,
      // it reloads the files map from the state, as the retry process might have altered file states.
      ;({ files } = this.getState())
    }

    // If no files to retry, proceed with original upload() behavior for new files

    /*
this.opts.onBeforeUpload(files): It calls the user-configurable onBeforeUpload
callback ([packages/@uppy/core/src/Uppy.ts:237-240][packages/@uppy/core/src/Uppy.ts]Uppy.ts ) )),
passing the current map of files. This hook allows the user to:
- Prevent the upload entirely by returning false.
- Modify the files (e.g., add/remove files, change metadata) by returning an updated files map.
- Do nothing and let the upload proceed by returning true or undefined (or the original files map).
    */

    const onBeforeUploadResult = this.opts.onBeforeUpload(files)

    if (onBeforeUploadResult === false) {
      return Promise.reject(
        new Error(
          'Not starting the upload because onBeforeUpload returned false',
        ),
      )
    }

    // If the hook returns a file map (an object), it means the user wants to use this modified set of files.
    if (onBeforeUploadResult && typeof onBeforeUploadResult === 'object') {

      // The local files variable is updated.
      files = onBeforeUploadResult
      // Updating files in state, because uploader plugins receive file IDs,
      // and then fetch the actual file object from state
      this.setState({
        files,
      })
    }

    // Promise Chain for Validations and Upload Execution: The rest
    // of the method is a promise chain (.then().catch().then()...).
    return Promise.resolve()
      .then(() => this.#restricter.validateMinNumberOfFiles(files))
      .catch((err) => {
        // ! this.informAndEmit([err]) emits `restriction-failed` or `error` event based on error.isRestriction
        this.#informAndEmit([err])
        throw err
      })
      .then(() => {
        if (!this.#checkRequiredMetaFields(files)) {
          throw new RestrictionError(this.i18n('missingRequiredMetaField'))
        }
      })
      .catch((err) => {
        // Doing this in a separate catch because we already emited and logged
        // all the errors in `checkRequiredMetaFields` so we only throw a generic
        // missing fields error here.
        throw err
      })
      .then(async () => {
        // Gets the map of currently active upload batches.
        const { currentUploads } = this.getState()

        // get a list of files that are currently assigned to uploads
        // Creates a flat array of all file IDs that are already part of any ongoing upload batch.
        const currentlyUploadingFiles = Object.values(currentUploads).flatMap(
          (curr) => curr.fileIDs,
        )

        // Initializes an array to hold IDs of files that should be included in this new upload batch.
        const waitingFileIDs: string[] = []
        //  Iterates through all files selected for upload (after onBeforeUpload and retries).
        Object.keys(files).forEach((fileID) => {
          const file = this.getFile(fileID)
          // if the file hasn't started uploading and hasn't already been assigned to an upload..
          // add them to the waitingFileIDs array. which would be used to create a new upload batch.
          if (
            !file.progress.uploadStarted &&
            currentlyUploadingFiles.indexOf(fileID) === -1
          ) {
            waitingFileIDs.push(file.id)
          }
        })


        // calling #createUpload(waitingFileIDs)
        // generates a unique ID for this new batch, emits an 'upload' event and updates Uppy's state
        // to include this new batch in currentUploads.
        const uploadID = this.#createUpload(waitingFileIDs)

        // #runUpload is the core engine that executes the pre-processing, uploading (via uploader plugins),
        // and post-processing steps for all files in the batch. It handles resumability and updates state throughout
        // the process. It returns an UploadResult.
        const result = await this.#runUpload(uploadID)

        // The ! asserts that result will not be null/undefined here.
        this.emit('complete', result!)
        return result
      })
      .catch((err) => {
        this.emit('error', err)
        this.log(err, 'error')
        throw err
      })
  }
}

export default Uppy
