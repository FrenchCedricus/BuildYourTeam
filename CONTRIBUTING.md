# Contributing to BuildYourTeam

Thanks for helping! The most valuable contribution is a **good team**: a set of agents that work well together on a real kind of task.

## Propose a team

1. **Fork** this repository and create a branch, for example `team/data-pipeline`.
2. **Create the team.** The easiest way is the wizard, then copy the result:
   ```bash
   node skill/byt.mjs new data-pipeline       # or /byt new in Claude Code
   cp -r .byt/teams/data-pipeline teams/
   ```
   You can also write the files by hand (see the format below).
3. **Validate** it:
   ```bash
   npm run validate
   npm test
   ```
4. **Open a pull request.** Describe what the team is for and give one or two example tasks you ran it on.

Do not edit `registry.json`: a GitHub Action regenerates it when your pull request is merged.

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

The CI rejects a team that:
- has a name that is not kebab-case, or that differs from its folder;
- has a lead that is not one of its agents;
- has an agent file that is missing, has no frontmatter, or whose `name` differs from its file name;
- has an agent without `tools` (it would inherit every tool), or that lists an unknown tool;
- has an unusual model, or an almost empty prompt.

Warnings count as errors for the public registry.

## Quality guidelines

- **Least privilege.** Give each agent only the tools its role needs. Reviewers, planners and advisers are read-only (`Read, Grep, Glob`). Use `Bash` only for agents that must run commands.
- **A real lead.** The lead's prompt names every teammate and its role. It explains how to split a task, brief teammates, run independent work in parallel, and end with a recap (who did what, results, remaining points).
- **Specific prompts.** Describe the method and the deliverable, not just the job title. Fifteen to forty lines is usually right.
- **Safety rules.** Agents that run commands must avoid destructive commands, `git push` and global installs unless the task asks for them.
- **English** for prompts and descriptions, so everyone can use the team.
- **Versioning.** When you change an existing team, bump its `version`, or `byt update` will not pick up your change.

## Code contributions

`skill/byt.mjs` and `skill/lib/` must stay **dependency-free** (Node.js 18+ built-ins only). Add tests in `test/` with `node:test` and run `npm test` before opening a pull request.
