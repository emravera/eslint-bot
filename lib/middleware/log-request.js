'use strict'
const util = require('../util/helpers');
const stdlog = require('../util/log');

/**
 * Capture some data from each request and send it to the logger
 * - set a Request-Id header so we can trace a request through the stack
 */
module.exports = function* requestLogger(next) {
  let tStart = Date.now();
  this.id = this.headers['request-id'] || util.token();
  this.log = stdlog.child({reqid: this.id});
  this.set('request-id', this.id);
  yield next;
  this.log.info({
    latency: Date.now() - tStart,
    ip: this.ip
  }, `${this.method} ${this.status} ${this.originalUrl}`);
}
