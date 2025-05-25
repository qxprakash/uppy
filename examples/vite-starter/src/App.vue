<script setup>
import { Dashboard } from '@uppy/vue'
import Uppy from '@uppy/core'
import GoldenRetriever from '@uppy/golden-retriever'
import Tus from '@uppy/tus' // Added Tus import

import '@uppy/core/dist/style.css'
import '@uppy/dashboard/dist/style.css'

const uppy = new Uppy()
  .use(GoldenRetriever, { serviceWorker: true })
  .use(Tus, { endpoint: 'https://tusd.tusdemo.net/files/' }) // Added Tus plugin
</script>

<template>
  <Dashboard :uppy="uppy" />
</template>
