<script setup>
import { Dashboard } from '@uppy/vue';
import Uppy from "@uppy/core"
import GoldenRetriever from "@uppy/golden-retriever"

import "@uppy/core/dist/style.css"
import "@uppy/dashboard/dist/style.css"

const uppy = new Uppy().use(GoldenRetriever, { serviceWorker: true })
</script>

<template>
  <Dashboard :uppy="uppy" />
</template>
