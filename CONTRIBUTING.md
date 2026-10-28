# Contributing to BuildYourTeam

Thanks for helping! The most valuable contribution is a **good team**: a set of agents that work well together on a real kind of task.

## Propose a team

1. **Fork** this repository and create a branch, for example `team/data-pipeline`.
2. **Create the team.** The easiest way is the wizard, then copy the result:
   ```bash
   node skill/byt.mjs new data-pipeline       # or /byt new in Claude Code
   cp -r .byt/teams/data-pipeline teams/
   ```
   The wizard does not ask for a version or an author: it writes `"version": "0.1.0"` and takes `author` from the `BYT_AUTHOR` environment variable, or else from your OS user name. Set `BYT_AUTHOR=<your-github-handle>` before running it, or edit `author` in `team.json` afterwards.
   `new` defaults to the project scope, so it writes the team to `./.byt/teams/data-pipeline` (which is why the `cp` works) and also writes `./.claude/agents/byt-data-pipeline-*.md` in the clone. Both `.byt/` and `.claude/` are in `.gitignore`, so only the copy in `teams/` ends up in your pull request.

   You can also write the files by hand (see the format below).
3. **Validate** it:
   ```bash
   npm run validate
   npm test
   ```
   To check only your team with the same strictness as the CI, run `node skill/byt.mjs validate teams/data-pipeline --strict` (without `--strict`, warnings do not block).
4. **Open a pull request.** Describe what the team is for and give one or two example tasks you ran it on.

Do not edit `registry.json`: a GitHub Action regenerates it when your pull request is merged. `npm run validate` runs the same checks locally without writing anything.

## Format

```text
teams/<team>/
├── team.json
└── agents/<agent>.md      # one file per agent declared in team.json
```

`team.json`:

| Field | Required | Rule |
| --- | --- | --- |
| `name` | yes | kebab-case, same as the folder name |
| `version` | yes | semver, for example `1.0.0` |
| `description` | yes | one sentence |
| `author` | yes | your name or GitHub handle |
| `tags` | no | list of strings |
| `lead` | yes | name of an agent of the team |
| `mode` | no | `subagents` (default) or `agent-team` |
| `agents` | yes | `[{ "name": "...", "enabled": true }]` |

Each agent file is a standard Claude Code subagent:

```markdown
---
name: backend
description: When to use this agent, in one or two sentences.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---

The system prompt.
```

## What the CI checks

On every pull request, the CI runs `npm run validate` (strict validation of every team in `teams/`), then the test suite (`npm test`) on Node 18, 20 and 22. On `main`, it regenerates `registry.json`, including a SHA-256 hash of every file. It rejects a team that:
- has a name that is not kebab-case, or that differs from its folder;
- has a `version` that is not semver (`1.0.0`, `1.0.0-beta.1`);
- has no `description`, or no `author`;
- has `tags` that are not a list of strings, or a `mode` other than `subagents` or `agent-team`;
- has a lead that is missing or is not one of its agents;
- declares no agent, or the same agent twice;
- has a file in `agents/` that is not declared in `team.json`;
- has an agent file that is missing, has no frontmatter, has no `name` or `description`, or whose `name` differs from its file name;
- has a frontmatter key other than `name`, `description`, `tools`, `model` and `color` (for example `permissionMode`, `hooks` or `mcpServers`), or the same key twice;
- has an agent without `tools` (it would inherit every tool), or that lists an unknown tool. Built-in Claude Code tools, `mcp__*` tools and patterns such as `Bash(npm test)` are accepted;
- has a `model` other than `haiku`, `sonnet`, `opus`, `inherit` or a `claude-*` model id;
- has an agent whose prompt (the text after the frontmatter) is shorter than 40 characters;
- has a lead with `Edit`, `Write`, `MultiEdit`, `NotebookEdit` or `Bash`, even restricted like `Bash(npm test)` (a warning in `validate`, and also checked by the tests).

Warnings count as errors for the public registry: `npm run validate` fails on them too.

## Troubleshooting

Validation messages are in French. The most common ones:

| Message | Fix |
| --- | --- |
| `name : « … » ne correspond pas au nom du dossier « … ».` | Make `name` in `team.json` match the folder name under `teams/`. |
| `agents/<agent>.md : name « … » différent du nom de fichier « … ».` | Make the `name` in the frontmatter match the file name, without `.md`. |
| `agents/<agent>.md : frontmatter absent (bloc --- en tête de fichier avec name, description, tools, model).` | Start the file with a `---` block, as in the example above. |
| `agents/<agent>.md : fichier introuvable.` | Every agent listed in `team.json` needs a file `agents/<agent>.md`. |
| `agents/<file>.md : fichier non déclaré dans team.json (ignoré).` | Add the agent to `agents` in `team.json`, or delete the file. |
| `agents/<agent>.md : outil inconnu « … ».` | Check the spelling and case of the tool (`Read`, not `read`), and separate tools with commas. |
| `agents/<agent>.md : le champ « tools » est obligatoire (sans lui, l'agent hériterait de tous les outils).` | Add a `tools:` line listing only what the role needs. |
| `agents/<agent>.md : clé « … » non autorisée dans le frontmatter` | Remove the key: only `name`, `description`, `tools`, `model` and `color` are allowed. |
| `lead « … » : a des droits de modification ou d'exécution` | Make the lead read-only (`Read, Grep, Glob`). |
| `agents/<agent>.md : modèle « … » inhabituel` | Use `haiku`, `sonnet`, `opus`, `inherit` or a `claude-*` id. |
| `agents/<agent>.md : prompt système très court.` | Write the system prompt below the frontmatter (at least 40 characters). |
| `author : non renseigné.` | Add `"author": "<your-github-handle>"` to `team.json`. |
| `version : « … » doit suivre le format semver (ex. « 1.0.0 »).` | Use three numbers, such as `0.1.0`. |
| `<team>/<lead> ne doit pas avoir Edit` (from `npm test`) | Remove `Edit`, `Write` and `Bash` from the lead's `tools`. |

## Quality guidelines

- **Least privilege.** Give each agent only the tools its role needs. The lead is always read-only (`Read, Grep, Glob`): it coordinates, and the tests reject a lead with `Edit`, `Write` or `Bash`. Pure reviewers and advisers are read-only too. Give a reviewer `Bash` only if it must run checks (tests, linters), and give `Edit, Write` only to agents that produce files. Use `Bash` only for agents that must run commands.
- **A real lead.** The lead's prompt names every teammate and its role. It explains how to split a task, brief teammates, run independent work in parallel, and end with a recap (who did what, results, remaining points).
- **Specific prompts.** Describe the method and the deliverable, not just the job title. Fifteen to forty lines is usually right.
- **Safety rules.** Agents that run commands must avoid destructive commands, `git push` and global installs unless the task asks for them.
- **English** for prompts and descriptions, so everyone can use the team.
- **Versioning.** When you change an existing team, bump its `version`, or `byt update` will not pick up your change.

## Code contributions

`skill/byt.mjs` and `skill/lib/` must stay **dependency-free** (Node.js 18+ built-ins only). Add tests in `test/` with `node:test` and run `npm test` before opening a pull request.
