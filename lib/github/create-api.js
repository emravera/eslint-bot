'use strict';
const pick = require('lodash/pick');
const request = require('./request');

function transform(src, keys) {
  const acc = {};
  for (let lk in keys) {
    if (keys.hasOwnProperty(lk)) {
      acc[keys[lk]] = src[lk];
    }
  }
  return acc;
}

function getPicker(val) {
  return val ? Array.isArray(val)
    ? pick
    : transform
    : Function.prototype;
}

/**
 * Generate an API request method
 * @param {function} url(props) => string
 * @param {string[]|object} queryProps Allowed query-string params
 * @param {string[]|object} bodyProps Allowed POST/PATCH body params
 * @param {string[]} required
 */
module.exports = function createAPIRequest(config) {
  const pickQuery = getPicker(config.queryProps);
  const pickBody = getPicker(config.bodyProps);
  return props => {
    if (config.required) {
      for (let index = 0; index < config.required.length; index++) {
        const propName = config.required[index];
        if (!props[propName]) {
          return Promise.reject(new request.Error(400, `.${propName} is null or undefined`));
        }
      }
    }
    return request({
      url: config.url(props),
      query: pickQuery(props, config.queryProps),
      body: pickBody(props, config.bodyProps),
      method: config.method,
      headers: config.headers,
      parseResponse: config.parseResponse || 'json',
    });
  };
};
