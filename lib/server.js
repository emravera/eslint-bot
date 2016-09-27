'use strict'
const util = require('./util/helpers')
const stdlog = require('./util/log')
let isClosing = false
let sockets = new Set()

/**
 * Root module for the API server
 */
let server = configure(require('koa')())
.use(require('./middleware/log-request'))
.use(function* (next) {
  // While shutting down, existing connections can still send requests.
  // Instead, start closing sockets immediately
  if (isClosing) {
    this.set('connection', 'close')
    this.status = 503
  }
  yield next
})
.use(function* guard(next) {
  try { yield next }
  catch (err) {
    this.status = err.statusCode || 500
    if (!err.silent) this.log.warn(err)
    if (err.expose) this.body = err.toString()
  }
})
.use(require('./routes/run'))
.listen(process.env.PORT, function () {
  stdlog.info({port: process.env.PORT}, 'ready')
})
.on('connection', function (sock) {
  // Track sockets so we can close them faster during shutdown.
  // Can also be used to count the number of active connections
  sockets.add(sock)
  sock.on('close', () => sockets.delete(sock))
})

function configure(app) {
  // Assume TLS terminated by a reverse proxy
  app.proxy = true

  return app
}

util.addShutdownListener(function () {
  isClosing = true
  const idle = parseInt(process.env.SHUTDOWN_SOCKET_IDLE)
  sockets.forEach(sock => sock.setTimeout(idle))
  server.close(() => {
    stdlog.fatal('shutdown')
  })
})
