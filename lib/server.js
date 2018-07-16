'use strict';

const util = require('./util/helpers');
const stdlog = require('./util/log');
const config = require('../config');

let isClosing = false;
const sockets = new Set();


/**
 * Root module for the API server
 */
const server = configure(require('koa')())
.use(require('./middleware/log-request'))
.use(function* (next) {
  // While shutting down, existing connections can still send requests.
  // Instead, start closing sockets immediately
  if (isClosing) {
    this.set('connection', 'close');
    this.status = 503;
  }
  yield next;
})
.use(function* guard(next) {
  try { yield next }
  catch (err) {
    this.status = err.statusCode || 500;
    if (!err.silent) this.log.warn(err);
    if (err.expose) this.body = err.toString();
  }
})
.use(require('./routes/run'))
.listen(config.port, function () {
  stdlog.info({port: config.port}, 'ready');
})
.on('connection', function (sock) {
  // Track sockets so we can close them faster during shutdown.
  // Can also be used to count the number of active connections
  sockets.add(sock);
  sock.on('close', () => sockets.delete(sock));
})

function configure(app) {
  // Assume TLS terminated by a reverse proxy
  app.proxy = true;
  return app;
}

util.addShutdownListener(() => {
  isClosing = true;
  const idle = parseInt(config.shutdown_idle);
  sockets.forEach(sock => sock.setTimeout(idle));
  server.close(() => {
    stdlog.fatal('shutdown');
  });
})
