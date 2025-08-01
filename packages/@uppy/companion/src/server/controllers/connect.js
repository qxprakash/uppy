const oAuthState = require('../helpers/oauth-state')

/**
 * Derived from `cors` npm package.
 * @see https://github.com/expressjs/cors/blob/791983ebc0407115bc8ae8e64830d440da995938/lib/index.js#L19-L34
 * @param {string} origin
 * @param {*} allowedOrigins
 * @returns {boolean}
 */
function isOriginAllowed(origin, allowedOrigins) {
  if (Array.isArray(allowedOrigins)) {
    return allowedOrigins.some((allowedOrigin) =>
      isOriginAllowed(origin, allowedOrigin),
    )
  }
  if (typeof allowedOrigins === 'string') {
    return origin === allowedOrigins
  }
  return allowedOrigins.test?.(origin) ?? !!allowedOrigins
}

const queryString = (params, prefix = '?') => {
  const str = new URLSearchParams(params).toString()
  return str ? `${prefix}${str}` : ''
}

function encodeStateAndRedirect(req, res, stateObj) {
  const { secret } = req.companion.options
  const state = oAuthState.encodeState(stateObj, secret)
  const { providerClass, providerGrantConfig } = req.companion

  // pass along grant's dynamic config (if specified for the provider in its grant config `dynamic` section)
  // this is needed for things like custom oauth domain (e.g. webdav)
  const grantDynamicConfig = Object.fromEntries(
    providerGrantConfig.dynamic?.flatMap((dynamicKey) => {
      const queryValue = req.query[dynamicKey]

      // note: when using credentialsURL (dynamic oauth credentials), dynamic has ['key', 'secret', 'redirect_uri']
      // but in that case, query string is empty, so we need to only fetch these parameters from QS if they exist.
      if (!queryValue) return []
      return [[dynamicKey, queryValue]]
    }) || [],
  )

  const { oauthProvider } = providerClass
  const qs = queryString({
    ...grantDynamicConfig,
    state,
  })

  // Now we redirect to grant's /connect endpoint, see `app.use(Grant(grantConfig))`
  res.redirect(req.companion.buildURL(`/connect/${oauthProvider}${qs}`, true))
}

function getClientOrigin(base64EncodedState) {
  try {
    const { origin } = JSON.parse(atob(base64EncodedState))
    return origin
  } catch {
    return undefined
  }
}

/**
 * Initializes the oAuth flow for a provider.
 *
 * The client has open a new tab and is about to be redirected to the auth
 * provider. When the user will return to companion, we'll have to send the auth
 * token back to Uppy with `window.postMessage()`.
 * To prevent other tabs and unauthorized origins from accessing that token, we
 * reuse origin(s) from `corsOrigins` to limit the scope of `postMessage()`, which
 * has `targetOrigin` parameter, required for cross-origin messages (i.e. if Uppy
 * and Companion are served from different origins).
 * We support multiple origins in `corsOrigins`, we have to figure out which
 * origin the current connect request is coming from. Because the OAuth window
 * was opened with `window.open()`, starting a new browsing context, the request
 * is not cross origin and we don't have a `Origin` header to work with.
 * That's why we use the client-provided base64-encoded parameter, check if it
 * matches origin(s) allowed in `corsOrigins` Companion option, and use that as
 * our `targetOrigin` for the `window.postMessage()` call (see `send-token.js`).
 *
 * @param {object} req
 * @param {object} res
 */
module.exports = function connect(req, res, next) {
  const stateObj = oAuthState.generateState()

  if (req.companion.options.server.oauthDomain) {
    stateObj.companionInstance = req.companion.buildURL('', true)
  }

  if (req.query.uppyPreAuthToken) {
    stateObj.preAuthToken = req.query.uppyPreAuthToken
  }

  // Get the computed header generated by `cors` in a previous middleware.
  stateObj.origin = res.getHeader('Access-Control-Allow-Origin')
  let clientOrigin
  if (!stateObj.origin) {
    clientOrigin = getClientOrigin(req.query.state)
  }
  if (!stateObj.origin && clientOrigin) {
    const { corsOrigins } = req.companion.options

    if (typeof corsOrigins === 'function') {
      corsOrigins(clientOrigin, (err, finalOrigin) => {
        if (err) next(err)
        stateObj.origin = finalOrigin
        encodeStateAndRedirect(req, res, stateObj)
      })
      return
    }
    if (isOriginAllowed(clientOrigin, req.companion.options.corsOrigins)) {
      stateObj.origin = clientOrigin
    }
  }
  encodeStateAndRedirect(req, res, stateObj)
}
module.exports.isOriginAllowed = isOriginAllowed
