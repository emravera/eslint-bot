This bot is designed to run [eslint][] on any files modified by a pull-request, and post the results in a review comment.

> <details><summary><b>2 problems (1 errors, 1 warnings)</b></summary>
```
index.js
  warn 2:5 'fizz' is defined but never used. [no-unused-vars]
lib/server.js
  err 2:1 Parsing error: The keyword 'const' is reserved
```
</details>

#### Setup
- fork this repository and commit your `.eslintrc` files to the `config/` directory
  - presets may be added to `package.json: .dependencies`
  - nested files are supported so you can mirror your project structure: `config/test/.eslintrc.json` & `config/.eslintrc.yml` will both apply
- create a Heroku app and set the ENV vars detailed in [`example.env`](example.env)
- create a new webhook on your github repository with:
  - Payload URL: `https://$YOUR_APP_NAME.herokuapp.com/run`
  - Content Type: `application/json`
  - Secret: `*****`
  - Events: `pull_request`

[eslint]: http://eslint.org
