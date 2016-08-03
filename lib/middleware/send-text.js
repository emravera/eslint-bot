'use strict'
const STATUS_CODES = require('http').STATUS_CODES
module.exports = function (req, res, next) {
  res.send = sendText
  next()
}

function sendText(statusCode, body) {
  if (statusCode instanceof Error) {
    statusCode = statusCode.statusCode || 500
  }
  statusCode = this.statusCode = statusCode || 204
  if (statusCode !== 204) {
    this.setHeader('content-type', 'text/plain;charset=utf-8')
    this.end((body || STATUS_CODES[statusCode]) + '\n')
  }
  else this.end()
}
