#!/usr/bin/env node
// BuildYourTeam: manages teams of Claude Code subagents.
// Use it from the /byt skill or directly: node byt.mjs <command> [--json]
import { main } from './lib/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
