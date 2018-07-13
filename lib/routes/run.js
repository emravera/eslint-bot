const cwd = require('path').resolve('config');
const relative = require('path').relative.bind(null, cwd);
const cli = new (require('eslint').CLIEngine)({ useEslintrc: true });
const util = require('../util/helpers');
const github = require('../github/api');
const FILE_FILTER = new RegExp(process.env.FILE_FILTER);
const MAX_ROWS_PER_FILE = 300;
const verifier = util.createAuth('pull_request', ['opened', 'synchronize']);

/**
 * Main method that runs eslint and comments automatically the PR
 *
 * - run eslint on any files modified by a pull-request
 * - calculate the range of the diff modified and filter the results
 * - post the results in a review-comment in the line of the finding.
 */
module.exports = function* (next) {
  if (this.path !== '/run') return yield next;

  yield verifier;
  const base = this.request.body.pull_request.base;
  const head = this.request.body.pull_request.head;
  const number = this.request.body.pull_request.number;
  const diff = yield github.compare({
    repo: base.repo.full_name,
    base: base.sha,
    head: head.sha,
  });

  //console.log(`DIFF: ${JSON.stringify(diff)}`);

  const files = diff.files.filter(el => FILE_FILTER.test(el.filename));
  if (!files.length) {
    this.body = 'No javascript files were modified';
    this.log.info(this.body);
    return;
  }

  //console.log(`FILES: ${JSON.stringify(files)}`);

  const filesRange = [];
  files.map((el, index) => {
    const range = getModifiedRangeLines(el);
    filesRange.push({
      range,
      number,
      filename: el.filename,
      repo: head.repo.full_name,
      commit_id: base.sha,
    });
  });

  //console.log(`FILES RANGE: ${JSON.stringify(filesRange)}`);

  let fetchers = files.map(el => {
    this.log.info (`filename ${el.filename} ref ${head.ref}`);
    return github.blob({
      repo: head.repo.full_name,
      ref: head.sha,
      path: el.filename,
    });
  });
  let blobs = yield Promise.all(fetchers);

  let result = files.map((el, index) => ({
    name: el.filename,
    sha: el.sha,
    content: blobs[index].toString(),
  }))
    .map(file => cli.executeOnText(file.content, file.name).results[0]);

  // We format the results in a structure [{file: 'name', errors: []}, ...]
  result = format(result, filesRange);

  if (!result) {
    // TODO: Approve the PR on Github
    this.body = 'No problems found';
    this.log.info(this.body);
    return;
  }

  if (this.query.dry) {
    this.body = result;
    this.log.info(this.body);
    return;
  }

  // Iterate the results and add the comments with the found erros.
  for (let i = 0; i < result.length; i++) {
    console.log(`RESULT for file ${result[i].file}`);
    if (result[i].errors.length > 0) {
      for (let j = 0; j < result[i].errors.length; j++) {
        console.log(`ERRORS: ${JSON.stringify(result[i].errors[j])}`);
        const commentBody = `<details><summary><b>${result[i].errors[j].rule}</b></summary>\n${result[i].errors[j].message}</details>`;
        const commentReq = {
          repo: base.repo.full_name,
          pr: number,
          commit_id: head.sha,
          body: commentBody,
          path: result[i].file,
          position: result[i].errors[j].line,
        };

        // Comment to the PR
        try {
          const comment = yield github.commentPR(commentReq);
          console.log(`URL: ${comment.html_url}`);
        } catch (e) {
          console.log('SKIPPED COMMENT');
          continue;
        }
      }
    }
  }

  // Return result
  this.body = result;
};

/**
 * Convert some ESLint results into a GitHub comment
 * @param {array} results
 * @return {array}
 */
function format(results, filesRange) {
  const count = { errors: 0, warnings: 0 };
  const fileDetails = [];

  for (let jj = 0; jj < results.length; jj++) {
    if (!results[jj]) {
      continue;
    }
    count.errors += results[jj].errorCount;
    count.warnings += results[jj].warningCount;
    if (results[jj].errorCount + results[jj].warningCount === 0) continue;

    const messagesCount = results[jj].messages.length;
    let detail = null;
    const descriptor = {};

    if (messagesCount > MAX_ROWS_PER_FILE) {
      detail = `OMITTED:  ${messagesCount} found! Too much problems...`;
    } else {
      detail = formatRows(results[jj].messages, filesRange[jj]);
    }
    descriptor.file = filesRange[jj].filename;
    descriptor.errors = detail;
    //console.log(`-> FILENAME ${descriptor.file}`);
    //console.log(`-> ERRORS ${JSON.stringify(descriptor.errors)}`);
    fileDetails.push(descriptor);
  }

  if (count.errors + count.warnings < 1) return null;
  return fileDetails;
}

function formatRows(messages, fileRange) {
  const rows = [];
  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];
    // This logic only adds failures of the range of the code review.
    if (msg.line >= fileRange.range.from && msg.line <= fileRange.range.to) {
      if (!isBlacklistedRule(msg.ruleId)) {
        rows.push({
          type: msg.severity === 2 ? 'ERROR' : 'WARN',
          rule: msg.ruleId || '',
          line: msg.line,
          column: msg.column,
          message: msg.message,
        });
      }
    }
  }
  return rows;
}

/**
 * This method extracts from the patch file the lines modified.
 * @param file
 * @returns {object}
 */
function getModifiedRangeLines(file) {
  let lines;
  if (file.patch) {
    const extract = file.patch.split('@@');
    lines = extract[1].trim().match('^-(\\d+),?(\\d*) \\+(\\d+),?(\\d*)$')[3];
    lines = parseInt(lines);
  }
  return { from: lines, to: lines + 14 };
}

/**
 *
 * @param rule
 */
function isBlacklistedRule(rule){
  const rules = ['import/no-unresolved'];
  const isBlacklisted = rules.includes(rule);
  return isBlacklisted;
}

// Expose for testing
module.exports.format = format;
module.exports.formatRows = formatRows;
