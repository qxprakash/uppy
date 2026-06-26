import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import GoldenRetriever from "@uppy/golden-retriever";
import Transloadit from "@uppy/transloadit";
import "@uppy/core/css/style.css";
import "@uppy/dashboard/css/style.css";

// Public demo creds (same as main.js). Swap for a slower template if you want a
// wider window to refresh in while the assembly is still encoding.
const TRANSLOADIT_KEY = "yuuSb4IgZv7ggltG97VewjTE5epR48et";
const TEMPLATE_ID = "71ca4de9ac8443e2bb2245881d902a81";

const uppy = new Uppy({ debug: true })
  .use(Dashboard, { inline: true, target: "#dashboard" })
  .use(Transloadit, {
    waitForEncoding: true,
    assemblyOptions: {
      params: {
        auth: { key: TRANSLOADIT_KEY },
        template_id: TEMPLATE_ID,
      },
    },
  })
  .use(GoldenRetriever);

window.uppy = uppy;

// Surface *why* an assembly failed (the bare `[Uppy] Error` hides the reason).
uppy.on("transloadit:assembly-error", (assembly, err) => {
  console.error("[#6017] assembly error:", err?.message, {
    error: assembly?.error,
    reason: assembly?.message ?? assembly?.reason,
  });
});
