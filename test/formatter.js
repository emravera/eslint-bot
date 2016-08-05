'use strict'
const assert = require('assert')
const linter = require('../lib/routes/run')

describe('comment formatter', function () {
  it('has padded columns', function () {
    let actual = linter.toColumns([
      ['err', '[foo-bar]', '10:4', 'peas and carrots'],
      ['warn', '[fizz]', '12:28', 'rubarb']
    ])
    assert.equal(actual, dent(`
      err  [foo-bar] 10:4  peas and carrots
      warn [fizz]    12:28 rubarb
    `))
  })

  it('works with sample data', function () {
    let cwd = process.env.PWD + '/config'
    let actual = linter.format([
      {filePath: cwd + '/foo.js', errorCount: 1, warningCount: 1, messages: [
        {severity: 1, ruleId: 'no-unused-vars', line: 2, column: 3, message: 'rubarb rubarb rubarb'},
        {severity: 2, ruleId: 'no-undef', line: 100, column: 4, message: 'peas and carrots peas and carrots'},
      ]},
      {filePath: cwd + '/fizz/buzz.js', errorCount: 1, warningCount: 1, messages: [
        {severity: 1, ruleId: 'semi', line: 40, column: 7, message: 'rubarb rubarb rubarb'},
        {severity: 2, ruleId: 'no-undef', line: 8, column: 1, message: 'peas and carrots peas and carrots'},
      ]},
    ])
    assert.equal(actual, dent(`
      <details><summary><b>4 problems (2 errors, 2 warnings)</b></summary>
      \`\`\`
      foo.js
      warn no-unused-vars 2:3   rubarb rubarb rubarb
      err  no-undef       100:4 peas and carrots peas and carrots

      fizz/buzz.js
      warn semi     40:7 rubarb rubarb rubarb
      err  no-undef 8:1  peas and carrots peas and carrots
      \`\`\`
      </details>
    `))
  })
})

/**
 * Removes leading indentation
 */
function dent(str) {
  return str.trim().split('\n').map(line => line.trim()).join('\n')
}
