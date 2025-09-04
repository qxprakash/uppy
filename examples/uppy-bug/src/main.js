import "./style.css";
import "@uppy/core/css/style.css";
import "@uppy/dashboard/css/style.css";

import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import AwsS3 from "@uppy/aws-s3";
import GoldenRetriever from "@uppy/golden-retriever";

const SERVER_URL = "http://localhost:4000";
const app = document.querySelector("#app");
app.innerHTML = `
  <div style="max-width: 900px;margin: 24px auto;">
    <h2>Uppy AWS S3 + Golden Retriever Repro</h2>
    <p>
      1) Add multiple files (5-10). 2) Wait until uploads start. 3) Refresh quickly (especially in Firefox).<br/>
      Observe that after reload, failed files are not restored due to 'complete' firing.
    </p>
    <div id="uppy"></div>
    <pre id="log" style="background:#111;color:#eee;padding:12px;border-radius:6px;white-space:pre-wrap"></pre>
  </div>
`;

function onUploadComplete(result) {
  console.log(
    "Upload complete! We’ve uploaded these files:",
    result.successful
  );
}
function onUploadSuccess(file, data) {
  console.log("Upload success! We’ve uploaded this file:", file.meta["name"]);
}

const uppy = new Uppy()
  .use(Dashboard, {
    inline: true,
    target: "#app",
  })
  .use(AwsS3, {
    id: "myAWSPlugin",
    endpoint: SERVER_URL,
  });

uppy.on("complete", onUploadComplete);
uppy.on("upload-success", onUploadSuccess);
