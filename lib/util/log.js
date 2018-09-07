/* eslint-disable no-console */
const omit = require('lodash/omit');
const merge = require('lodash/merge');
const config = require('../../config');

const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
const LOG_LEVEL = LEVELS[config.log_level];
const RESERVED_PROPS = ['msg', 'err'];

/**
 * log.info([propsOrError], [msg])
 * log.warn(err, 'bad news')
 * log.debug({foo: 'bar'}, 'something happened')
 * child(opt) => Logger
 */
class Logger {
  constructor(props) {
    this.props = props;
  }

  child(props) {
    return new Logger(merge(props, this.props));
  }
}

Object.keys(LEVELS).forEach(function (name) {
  Logger.prototype[name] = createMethod(name.toUpperCase(), LEVELS[name])
})

// TODO serializers for common props
const serializers = [];

function createMethod(type, level) {
  if (level < LOG_LEVEL) return Function.prototype;
  /**
   * @example stdlog.info('Hello, World!')
   * @example stdlog.error(new Error(), 'something failed')
   * @example stdlog.error({ err:new Error(), msg:'something failed' })
   * @example stdlog.warn({foo:true}, 'stuff')
   * @param {object|Error?} props
   * @param {string} msg
   */
  return function createRecord(props, msg) {
    let err = null;
    if (typeof props === 'string') {
      msg = props;
      props = null;
    }
    if (typeof msg !== 'string') msg = '';
    if (props instanceof Error) {
      err = props.stack;
      props = null;
    }
    else if (props && typeof props === 'object') {
      if (!msg && typeof props.msg === 'string') msg = props.msg;
      if (props.err instanceof Error) err = props.err.stack;
      props = omit(props, RESERVED_PROPS);
    }
    if (this.props) {
      props = merge(props, this.props);
    }
    serializers.forEach(fn => fn(props))
    toConsole({type, level, msg, props, err});
  };
}

function toConsole(rec) {
  process.stdout.write(`${rec.type}' '`);
  if (rec.msg) console.log(rec.msg);
  if (rec.props) console.log(rec.props);
  if (rec.err) console.log(rec.err);
}

module.exports = new Logger();
