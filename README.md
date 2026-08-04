<div align="center">

![kulala-cli Logo][logo]

# kulala-cli

[![npm][badge-npm]][link-npm]
[![Made with love][badge-made-with-love]][contributors]
[![Discord][badge-discord]][discord]
[![Development status][badge-development-status]][development-status]
[![Our manifesto][badge-our-manifesto]][our-manifesto]
[![AI Policty][badge-ai-policy]][ai-policy]

[Install](#install) •
[Usage](#usage)

<p></p>

A fully-featured 🤏 HTTP/GraphQL/gRPC/Websocket-client 🐼
interface 🖥️ for your command-line ❤️,
that supports the Jetbrains .http spec (with full scripting support).

<p></p>

# Other tools 🔧 from the Kulala 🐼 family 🌈

[Kulala for Neovim][kulala.nvim] •
[Kulala Formatter (and converter)][kulala-fmt] •
[Kulala Desktop][kulala-desktop] •
[Kulala for Visual Studio Code][kulala.vscode] •
[Kulala Core][kulala-core]
[Kulala Github Action][kulala-github-action]

---

</div>

## Install

You can install kulala-cli globally using `npm`, `bun`, `yarn` or `pnpm`:

```sh
npm install -g @mistweaverco/kulala-cli
bun add -g @mistweaverco/kulala-cli
yarn global add @mistweaverco/kulala-cli
pnpm add -g @mistweaverco/kulala-cli
```

You can also run it directly without installation using

`npx`, `bunx`, `yarn dlx` or `pnpx`:

```sh
npx @mistweaverco/kulala-cli run --tests file.http
bunx @mistweaverco/kulala-cli run --tests file.http
yarn dlx @mistweaverco/kulala-cli run --tests file.http
pnpx @mistweaverco/kulala-cli run --tests file.http
```

On install, kulala-cli downloads a matching
[kulala-core](https://github.com/mistweaverco/kulala-core)
binary automatically.

If install scripts are disabled
(for example `npm install --ignore-scripts`),
the binary is downloaded on first use instead.

To use your own kulala-core binary, set `KULALA_CORE_PATH`:

```sh
export KULALA_CORE_PATH=/path/to/kulala-core
```

### Usage

Run a `.http` file and print human-readable output:

```sh
kulala run file.http
```

Run a `.http` file and print the raw kulala-core JSON output:

```sh
kulala run --json file.http
```

Run a `.http` file and only print test output (full output on failures):

```sh
kulala run --tests file.http
```

Run curl with human-readable output (supports normal curl flags):

```sh
kulala curl -I https://echo.kulala.app/get
kulala curl -H "Accept: application/json" https://echo.kulala.app/get
```

Run all files in a directory and only print test output:

```sh
kulala run --tests ./requests
```

Run all files in a directory (in random order) and only print test output:

```sh
kulala run --tests --shuffle ./requests
```

Only print output when a request fails:

```sh
kulala run --quiet ./requests
```

Stop after the first failing request or file:

```sh
kulala run --halt ./requests
```

Select an environment for variable resolution:

```sh
kulala run --tests --env=production file.http
```

Run a single request by block name (`###` name):

```sh
kulala run file.http --name MyRequest
```

Run the request at a cursor location (1-based line and column, same as kulala.nvim):

```sh
kulala run file.http --line 17
kulala run file.http --line 19 --column 1
```

When using `--name`, `--line`,
or `--column`, `<path>` must be a single `.http` or
`.rest` file.

### Exit behaviour

kulala-cli exits with code `1` when any request fails. By default, all requests
in a file and all files in a directory are run even when failures occur. Pass
`--halt` to stop after the first failing request within a file and skip remaining
files in a directory.

Success is determined by kulala-core's `success` flag, so operators such as
`// @kulala-expect-status-code` are respected (for example, an expected `404` is
treated as a pass).

### Development

```sh
pnpm install
pnpm run build
pnpm run lint
node dist/cli.cjs --help
```

To use a locally built kulala-core binary during development:

```sh
export KULALA_CORE_PATH=/path/to/kulala-core/dist/kulala-core
node dist/cli.cjs run file.http
```

## Docker

### Run docker interactively and pseudo-TTY:

Run interactively with a mounted `.http` file:

**via ghcr.io**

```sh
# via ghcr.io
docker run -it \
  -v ${PWD}/test.http:/app/test.http \
  ghcr.io/mistweaverco/kulala-cli:latest \
  run test.http \
 --name
```

**via Docker Hub**

```sh
docker run -it \
  -v ${PWD}/test.http:/app/test.http \
  mistweaverco/kulala-cli:latest \
  run test.http \
 --name
```

### Run docker non-interactively, but with a pseudo-TTY:

Run one request by block name (`###` name) with
a mounted `.http` file and pseudo-TTY:

**via ghcr.io**

```sh
docker run -t \
  -v ${PWD}/test.http:/app/test.http \
  ghcr.io/mistweaverco/kulala-cli:latest \
  run test.http \
 --name "My Request Name"
```

**via Docker Hub**

```sh
docker run -t \
  -v ${PWD}/test.http:/app/test.http \
  mistweaverco/kulala-cli:latest \
  run test.http \
 --name "My Request Name"
```

### Run docker non-interactively and without a pseudo-TTY; all requests in a directory:

Run all requests in a directory without
a pseudo-TTY (for example, in CI):

**via ghcr.io**

```sh
docker run \
  -v ${PWD}/http-files-dir:/app/http-files-dir \
  ghcr.io/mistweaverco/kulala-cli:latest \
  run ./http-files-dir
```

**via Docker Hub**

```sh
docker run \
  -v ${PWD}/http-files-dir:/app/http-files-dir \
  mistweaverco/kulala-cli:latest \
  run ./http-files-dir
```

### Build Docker and Push to Container Registry:

**to ghcr.io**

```sh
docker buildx build --push \
  -t ghcr.io/mistweaverco/kulala-cli:latest \
  -f Dockerfile .
```

**to Docker Hub**

```sh
docker buildx build --push \
  -t mistweaverco/kulala-cli:latest \
  -f Dockerfile .
```

[logo]: https://raw.githubusercontent.com/mistweaverco/kulala-cli/main/assets/logo.svg
[badge-npm]: https://img.shields.io/npm/v/@mistweaverco/kulala-cli?style=for-the-badge
[link-npm]: https://www.npmjs.com/package/@mistweaverco/kulala-cli
[badge-discord]: https://mistweaverco.com/assets/badges/discord.svg
[discord]: https://mistweaverco.com/discord
[badge-made-with-love]: https://mistweaverco.com/assets/badges/made-with-love.svg
[contributors]: https://github.com/mistweaverco/kulala-cli/graphs/contributors
[kulala.nvim]: https://github.com/mistweaverco/kulala.nvim
[kulala-fmt]: https://github.com/mistweaverco/kulala-fmt
[kulala-desktop]: https://github.com/mistweaverco/kulala-desktop
[kulala.vscode]: https://github.com/mistweaverco/kulala.vscode
[kulala-core]: https://github.com/mistweaverco/kulala-core
[kulala-github-action]: https://github.com/mistweaverco/kulala-github-action
[demo-image]: https://github.com/user-attachments/assets/a7b3b01f-0115-44dc-94d2-8abd4db6fb60
[badge-development-status]: https://mistweaverco.com/assets/badges/development-status.svg
[development-status]: https://mistweaverco.com/roadmap?filter=kulala-cli
[badge-ai-policy]: https://mistweaverco.com/assets/badges/ai-policy.svg
[ai-policy]: https://mistweaverco.com/ai-policy
[badge-our-manifesto]: https://mistweaverco.com/assets/badges/our-manifesto.svg
[our-manifesto]: https://mistweaverco.com/manifesto
