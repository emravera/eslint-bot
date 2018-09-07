const request = require('honeybee').withPromise;
const co = require('co');
const stdlog = require('./util/log');
const github = require('./github/api');
const util = require('./util/helpers');
const APP_URL = `http://localhost:${process.env.PORT}/run`;
const repo = process.argv[2];
const ids = process.argv.slice(3);

/**
 * Simulate a webhook request
 * Usage: npm run repl -- lib/simulate.js <owner>/<repo> <id> [<id> ...]
 */
function* run(opt) {
  const pull_request = yield github.pull(opt);
  const res = yield request({
    method: 'POST',
    url: APP_URL,
    body: { action: 'opened', pull_request },

    // TODO make this a command line option "--dry-run"
    // query: {dry: true},

    gzip: true,
    serialize: serializeWebhook,
    parseResponse: 'raw',
    parseError: 'text',
  });
  stdlog.info(res.toString());
}

function serializeWebhook(req) {
  req.body = Buffer.from(JSON.stringify(req.body));
  req.headers['content-type'] = 'application/json';
  req.headers['x-github-event'] = 'pull_request';
  req.headers['x-hub-signature'] = util.sign(req.body);
}

for (let index = 0; index < ids.length; index++) {
  co(run, { repo, id: ids[index] })
    .catch(err => stdlog.warn(`${err.statusCode}' '${err.message}`));
}
