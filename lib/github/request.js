const request = require('honeybee');
const config = require('../../config');

module.exports = request.withBindings(Promise, {
  parseError: parseGitHubError,
  headers: {
    accept: 'application/vnd.github.v3+json',
    authorization: 'Basic ' + Buffer.from(config.github_user + ':' + config.github_password).toString('base64'),
    'user-agent': config.user_agent,
  },
});
module.exports.Error = request.Error;
module.exports.parseError = parseGitHubError;

/**
 * Errors may come as:
 * - {message}
 * - {message, errors: [{code, resource, field}, ...]}
 * - {message, errors: [{code: 'custom', resource, field, message}, ...]}
 * @example
 *   { message: 'Validation Failed',
 *     errors: [{
 *       code: 'custom',
 *       resource: 'CommitComment',
 *       field: 'body',
 *       message: 'body is too long (maximum is 65536 characters)' }]
 */
function parseGitHubError(req, res) {
  const payload = request.parseJSON(res.body.toString());
  let message = payload && payload.message;
  if (payload) {
    const detail = payload.errors && payload.errors.map((err) => {
      if (err.code === 'custom') {
        return `${err.resource}.${err.field}: ${err.message}`;
      }
      return `${err.code}: ${err.resource}.${err.field}`;
    }).join('\n');
    if (detail && message) {
      message += '\n' + detail;
    }
    else if (detail) {
      message = detail;
    }
  }
  return new request.Error(res.statusCode, message);
}
