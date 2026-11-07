---
"@uppy/audio": patch
"@uppy/components": patch
"@uppy/core": patch
"@uppy/dashboard": patch
"@uppy/drag-drop": patch
"@uppy/drop-target": patch
"@uppy/image-editor": patch
"@uppy/image-generator": patch
"@uppy/react": patch
"@uppy/screen-capture": patch
"@uppy/status-bar": patch
"@uppy/svelte": patch
"@uppy/url": patch
"@uppy/vue": patch
"@uppy/webcam": patch
"uppy": patch
---

Minified CSS is now produced by esbuild instead of cssnano: same styles, slightly different bytes. For Safari and iOS, the minified files now also include the `-webkit-` prefixed `appearance` and `user-select` declarations.
