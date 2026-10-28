#!/usr/bin/env node
// BuildYourTeam : gère des teams de subagents Claude Code.
// Utilisable depuis le skill /byt ou directement : node byt.mjs <commande> [--json]
import { main } from './lib/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
