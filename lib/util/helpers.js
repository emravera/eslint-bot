'use strict'
const once = require('lodash/once')
const request = require('@cody-greene/request')
const crypto = require('crypto')
const SHARED_SECRET = process.env.SHARED_SECRET

/**
 * @param {Buffer) buf
 * @returns {string} Url-safe base64 encoding
 */
function toSafe64(buf) {
  return buf.toString('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=+$/, '')
}

/**
 * Gracefully exit with SIGINT (^c) or SIGTERM
 * Forcefully exit with SIGQUIT (^\)
 * @param {function} fn Use this to close any open connections or timers so the process can exit
 */
function addShutdownListener(fn) {
  fn = once(fn)
  process.on('SIGINT', fn).on('SIGTERM', fn)
}

/**
 * Constant time equality between Buffers.
 * It shortcuts on length, but that doesn't leak the contents
 */
function equal(actual, expected) {
  if (!actual || !expected) return false
  let acc = 0
  let index = actual.length
  if (index !== expected.length) return false
  while (index--) acc |= actual[index] ^ expected[index]
  return !acc
}

// Generate a random 24-character (144-bit) string
function token() {
  return toSafe64(crypto.randomBytes(18))
}

function sign(payload) {
  return 'sha1=' + crypto.createHmac('sha1', SHARED_SECRET).update(payload).digest('hex')
}

function verify(signature, body) {
  var expected = sign(body)
  return equal(signature, expected)
}

module.exports = {
  addShutdownListener,
  equal,
  parseJSON: request.parseJSON,
  sign,
  toSafe64,
  token,
  verify,
}
