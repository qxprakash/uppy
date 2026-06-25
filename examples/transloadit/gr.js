import Uppy from '@uppy/core'
import Dashboard from '@uppy/dashboard'
import GoldenRetriever from '@uppy/golden-retriever'
import Transloadit from '@uppy/transloadit'
import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'

// Public demo creds (same as main.js). Swap for a slower template if you want a
// wider window to refresh in while the assembly is still encoding.
const TRANSLOADIT_KEY = '35c1aed03f5011e982b6afe82599b6a0'
const TEMPLATE_ID = 'bbc273f69e0c4694a5a9d1b587abc1bc'

const uppy = new Uppy({ debug: true })
  .use(Dashboard, { inline: true, target: '#dashboard' })
  .use(Transloadit, {
    waitForEncoding: true,
    assemblyOptions: {
      params: {
        auth: { key: TRANSLOADIT_KEY },
        template_id: TEMPLATE_ID,
      },
    },
  })
  .use(GoldenRetriever)

window.uppy = uppy

// Surface *why* an assembly failed (the bare `[Uppy] Error` hides the reason).
uppy.on('transloadit:assembly-error', (assembly, err) => {
  console.error('[#6017] assembly error:', err?.message, {
    error: assembly?.error,
    reason: assembly?.message ?? assembly?.reason,
  })
})
