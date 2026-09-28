import { testCommand } from './run.js';

// Clones real-world Rust files into examples/ on the first run, which takes a few minutes.
testCommand(
  'fails to parse exactly the real-world Rust files in script/known-failures.txt',
  ['script/parse-examples', '--check'],
  1_800_000
);
