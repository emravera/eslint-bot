'use strict'
const util = require('./util/helpers')
const stdlog = require('./util/log')
let isClosing = false
let sockets = new Set()

/**
 * Root module for the API server
 */
let server = require('connect')()
  .use(require('./middleware/send-text'))
  .use(function (req, res, next) {
    // While shutting down, existing connections can still send requests.
    // Instead, start closing sockets immediately
    if (isClosing) {
      res.setHeader('connection', 'close')
      res.send(503)
    }
    else next()
  })
  .use(require('./middleware/log-request'))

  // Routes
  .use('/run', require('./routes/run'))

  .use(function (req, res){ res.send(404) })
  .use(function (err, req, res, next) { // eslint-disable-line no-unused-vars
    // The special 4-arg signature is required, even if we dont use `next()`
    if (!err.statusCode || err.statusCode >= 500) req.log.warn(err)
    res.send(err)
  })
  .listen(process.env.PORT, function () {
    stdlog.info({port: process.env.PORT}, 'ready')
  })
  .on('connection', function (sock) {
    // Track sockets so we can close them faster during shutdown.
    // Can also be used to count the number of active connections
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
  })

util.addShutdownListener(function () {
  isClosing = true
  const idle = parseInt(process.env.SHUTDOWN_SOCKET_IDLE)
  sockets.forEach(sock => sock.setTimeout(idle))
  server.close(function () {
    stdlog.fatal('shutdown')
  })
})
