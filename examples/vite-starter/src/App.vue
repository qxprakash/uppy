<script setup>
import { Dashboard } from '@uppy/vue'
import Uppy from '@uppy/core'
import GoldenRetriever from '@uppy/golden-retriever'
import Tus from '@uppy/tus' // Added Tus import

import '@uppy/core/dist/style.css'
import '@uppy/dashboard/dist/style.css'

const uppy = new Uppy()
  .use(GoldenRetriever, { serviceWorker: false })
  .use(Tus, { endpoint: 'https://tusd.tusdemo.net/files/' }) // Added Tus plugin

uppy.on('complete', (result) => {
  console.log('Upload complete!', result)
})
</script>

<template>
  <Dashboard :uppy="uppy" />
</template>
