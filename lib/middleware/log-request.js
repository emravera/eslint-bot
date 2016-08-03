'use strict'
const util = require('../util/helpers')
const stdlog = require('../util/log')

/**
 * Capture some data from each request and send it to the logger
 * - set a Request-Id header so we can trace a request through the stack
 */
module.exports = function requestLogger(req, res, next) {
  let id = req.id = req.headers['request-id'] || util.token()
  let tStart = Date.now()
  let log = req.log = res.log = stdlog.child({reqid: id})
  res.setHeader('request-id', id)
  res.on('finish', function () {
    log.info({
      latency: Date.now() - tStart,
    }, `${req.method} ${this.statusCode} ${req.originalUrl}`)
  })
  next()
}
