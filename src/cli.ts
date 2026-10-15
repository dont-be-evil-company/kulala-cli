import pkg from './../package.json';
import { Command } from 'commander';
import { run } from './lib/runner';
import { curl } from './lib/runner/curl';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { extractRequestNamesFromHttp, pickOne } from './lib/interactive';
import { resolveSingleHttpFile } from './lib/runner/limit';
import { formatSearchMatches, kulalaCore } from './lib/kulala-core';

const program = new Command();

program
  .name('kulala')
  .description('A fully-featured HTTP/GraphQL/gRPC/WebSocket client for your command-line.')
  .version(pkg.version);

async function main(): Promise<void> {
  if (process.argv[2] === 'curl') {
    await curl(process.argv.slice(3));
    return;
  }

  program
    .command('run')
    .description('Run .http or .rest files')
    .argument('<path>', 'file or directory to run')
    .option('--json', 'print raw kulala-core JSON output')
    .option('--tests', 'only print test output (full output on failures)')
    .option('--report', '(deprecated) use --tests')
    .option('--no-color', 'disable syntax highlighting and colors')
    .option('-q, --quiet', 'only print output when errors occur')
    .option('--halt', 'stop after the first failing request or file')
    .option('--shuffle', 'shuffle files when running a directory')
    .option('--env [name]', 'environment name for variable resolution')
    .option('--name [name]', 'run a single request by block name')
    .option('--line <line>', 'run request at 1-based line number', (value) =>
      Number.parseInt(value, 10),
    )
    .option('--column <column>', '1-based column for --line (default: 1)', (value) =>
      Number.parseInt(value, 10),
    )
    .action(async (inputPath, options) => {
      // When --name/--env are provided without an argument, commander sets them to true.
      if (options.name === true) {
        const relativeFile = resolveSingleHttpFile(inputPath);
        const absolutePath = path.resolve(process.cwd(), relativeFile);
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const requestNames = extractRequestNamesFromHttp(content);

        if (requestNames.length === 0) {
          console.error(chalk.red('No request blocks found (expected lines like: ### MyRequest)'));
          process.exit(1);
        }

        options.name = await pickOne(
          'Select request to run',
          requestNames.map((n) => ({ name: n, value: n })),
        );
      }

      if (options.env === true) {
        const startDir = fs.existsSync(inputPath)
          ? fs.statSync(inputPath).isDirectory()
            ? path.resolve(process.cwd(), inputPath)
            : path.dirname(path.resolve(process.cwd(), inputPath))
          : process.cwd();

        const absoluteInputPath = path.resolve(process.cwd(), inputPath);
        const filepath =
          fs.existsSync(absoluteInputPath) && fs.statSync(absoluteInputPath).isFile()
            ? absoluteInputPath
            : undefined;

        const catalog = await kulalaCore.environments({ cwd: startDir, filepath });
        const envNames = Object.keys(catalog.environments ?? {}).sort((a, b) => a.localeCompare(b));

        if (envNames.length === 0) {
          console.error(chalk.red('No environments found.'));
          process.exit(1);
        }

        options.env = await pickOne(
          'Select environment',
          envNames.map((n) => ({ name: n, value: n })),
        );
      }

      await run(inputPath, options);
    });

  program
    .command('search')
    .description('Search persisted request history')
    .argument('[query...]', 'search query (field filters: request.name:, response.body:, …)')
    .option('--json', 'print raw JSON')
    .option('--fuzzy', 'fuzzy subsequence match')
    .option('--limit <n>', 'maximum matches', (value) => Number.parseInt(value, 10))
    .action(async (queryParts: string[], options: { json?: boolean; fuzzy?: boolean; limit?: number }) => {
      const query = queryParts.join(' ');
      const result = await kulalaCore.searchHistory({
        query,
        fuzzy: options.fuzzy,
        limit: options.limit,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(formatSearchMatches(result.matches));
    });

  program.parse();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
