#!/usr/bin/env node

// npm `bin` entry. Calls main() unconditionally: a bin must never silently do nothing.
import { main } from "./cli.ts";

await main();
