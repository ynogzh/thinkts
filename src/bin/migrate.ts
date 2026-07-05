#!/usr/bin/env bun
import { runMigrateCLI } from "../migrate";

const rootPath = process.cwd();
const args = process.argv.slice(2);

runMigrateCLI(args, rootPath)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
