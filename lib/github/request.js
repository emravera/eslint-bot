'use strict'
const request = require('@cody-greene/request')
module.exports = request.withBindings({
  // parseError: parseGithubError
  headers: {
    'accept': 'application/vnd.github.v3+json',
    'authorization': 'Basic ' + new Buffer(process.env.GH_USER + ':' + process.env.GH_TOKEN).toString('base64'),
    'user-agent': process.env.USER_AGENT,
  }
})
module.exports.Error = request.Error
