# BuildYourTeam

**Teams of Claude Code subagents, installed and run with one command.**

BuildYourTeam (BYT) adds a single `/byt` command to [Claude Code](https://code.claude.com). With it you can install ready-made teams of specialised subagents from a community registry, switch agents on and off, create your own teams with a guided wizard, and run a whole team on a task.

```text
/byt install software-dev
/byt run software-dev "Add password reset by email"
```

The lead splits the task, delegates each part to the right specialist (architect, backend, frontend, reviewer, docs), runs independent work in parallel, and ends with a recap of who did what.

---

## Install

Requires **Node.js 18+** and Claude Code.

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/FrenchCedricus/BuildYourTeam/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/FrenchCedricus/BuildYourTeam/main/install.ps1 | iex
```

**From a clone**

```bash
git clone https://github.com/FrenchCedricus/BuildYourTeam.git
cd BuildYourTeam
./install.sh        # or .\install.ps1 on Windows
```

The installer copies the skill to `~/.claude/skills/byt/` (or `$CLAUDE_CONFIG_DIR/skills/byt/`) and creates `~/.byt/` (or `$BYT_HOME`). With the one-line installer, set `BYT_BRANCH` to install from another branch than `main` (from a clone, the checked-out files are installed). Running it again replaces the skill folder; your teams in `~/.byt/` are kept. Restart Claude Code if `/byt` does not show up.

## Quick start

```text
/byt list --available          # browse the registry
/byt install software-dev      # install a team
/byt info software-dev         # see its agents, tools and models (once installed)
/byt run software-dev "Fix the failing login test"
```

## Commands

| Command | What it does |
| --- | --- |
| `/byt help` | Show help |
| `/byt list` | Installed teams, with active and inactive agents |
| `/byt list --available` | Teams available in the registry |
| `/byt search <word>` | Search the registry by name, description or tag |
| `/byt info <team>` | Details of a team and its agents (tools and models only for installed teams; registry teams show agent names) |
| `/byt install <team>` | Install a team from the registry |
| `/byt uninstall <team>` | Remove a team |
| `/byt update [team]` | Update one team, or all of them |
| `/byt enable <team> [agent]` | Enable a team, or a single agent |
| `/byt disable <team> [agent]` | Disable a team, or a single agent |
| `/byt use <team>` | Enable a team and sync its agents |
| `/byt run <team> <task>` | Run the team on a task |
| `/byt new [team]` | Create a team with a guided wizard |
| `/byt add-agent <team>` | Add an agent to a team |
| `/byt remove-agent <team> <agent>` | Remove an agent from a team |
| `/byt validate [team\|folder] [--strict]` | Check a team's files (`--strict`: warnings fail too) |
| `/byt sync` | Re-sync active agents into `.claude/agents/` |
| `/byt config [key] [value]` | Show or change the configuration |
| `/byt trust <team>` | Approve a team that came with the project's `.byt/` folder |
| `/byt help [command]` | Show help for one command |
| `/byt version` | Show the BYT version |

**Options:**

- `--project` / `--global`: where to act. `install` defaults to global, `new` to the current project; the other commands look in the project first, then global.
- `--from <team>`: start `new` from an existing team.
- `--data <json|->`: JSON input for `new` and `add-agent` (`-` reads it from stdin).
- `--json`: machine-readable output.
- `--force`: replace an existing team (`install`, `new`), re-download on `update` even when up to date, and confirm the deletion of a local team on `uninstall`.
- `-h` / `--help`, `--version`.

## Teams in the registry

| Team | For | Agents |
| --- | --- | --- |
| `software-dev` | Building features | lead, architect, backend, frontend, reviewer, docs |
| `testing` | QA and debugging | lead, test-planner, unit-tester, e2e-tester, bug-hunter |
| `legacy-modernization` | Refactoring old code safely | lead, code-archaeologist, test-guardian, refactorer, migration-reviewer |
| `devops` | CI/CD and infrastructure | lead, ci-engineer, infra-engineer, reliability-engineer, config-auditor |
| `security-audit` | Defensive review of your code | lead, threat-modeler, code-auditor, dependency-auditor, remediation-advisor |
| `mobile-app` | iOS and Android apps | lead, ux-designer, mobile-dev, api-integrator, mobile-tester |
| `ux-design` | Usability and UI | lead, ux-auditor, interaction-designer, ui-engineer, accessibility-reviewer |
| `data-science` | Analysis and ML | lead, data-engineer, data-analyst, ml-engineer, stats-reviewer |
| `game-dev` | Making games | lead, game-designer, gameplay-dev, level-designer, playtester |
| `documentation` | Docs that match the code | lead, doc-architect, api-documenter, tutorial-writer, doc-reviewer |
| `product-management` | Specs and roadmaps | lead, user-researcher, product-analyst, spec-writer, roadmap-planner |
| `research` | Cited research reports | lead, scout, analyst, fact-checker, report-writer |
| `content-marketing` | Articles and SEO | lead, researcher, writer, seo-specialist, copy-editor |
| `translation` | Translation and localization | lead, terminologist, translator, localization-engineer, cultural-reviewer, linguistic-qa |
| `brainstorming` | Ideas and decisions | facilitator, visionary, critic, pragmatist, synthesizer |

Each agent gets only the tools its role needs. Leads never edit files or run commands. Roles that must run commands (developers, engineers, testers) get `Bash`; writers, designers and translators do not. Some reviewers and auditors get it too, to run checks (for example `doc-reviewer`, `accessibility-reviewer`, `dependency-auditor`). Only roles that need sources get web access (`WebSearch`, `WebFetch`), such as `scout`, `fact-checker`, `seo-specialist` or `terminologist`.

## Create your own team

```text
/byt new
```

The wizard asks a few questions with clickable answers: name and goal, starting point, project type, roles, access level and model for each agent, and mode. Every question has a recommended answer, so you can accept everything in a few clicks. Claude then writes the system prompts and BYT validates the team.

Teams you create are stored in the current project (`.byt/teams/`), or in `~/.byt/teams/` with `--global`. They are marked as local, so `update` never overwrites them.

Want to share yours? See [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

- **One skill, one script.** `/byt` is a skill that hands every deterministic command to `byt.mjs`, a dependency-free Node.js script. Only `run`, `new` and `add-agent` use Claude's reasoning.
- **Safe sync.** Only *active* agents are copied to `~/.claude/agents/` (or `.claude/agents/` in project mode), named `byt-<team>-<agent>.md`. BYT never touches agent files it did not create. Every team is validated again before its agents are synced, and BYT never writes or deletes a file outside the agents folder, even if `state.json` or `team.json` was tampered with.
- **Two modes.** `subagents` (default): Claude acts as the lead and delegates to subagents. `agent-team`: the agents become teammates in an [agent team](https://code.claude.com/docs/en/agent-teams). This mode is experimental and needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, set in your environment or in the `env` block of `~/.claude/settings.json`, `.claude/settings.json` or `.claude/settings.local.json`.
- **Configurable registry.** The default registry is this repository. Point BYT at your own with `node ~/.claude/skills/byt/byt.mjs config registry <url>`, where `<url>` is the folder that contains `registry.json` (an `https://` URL, a `file://` URL or a local path). The `BYT_REGISTRY` environment variable overrides it.

### Security

- **Least privilege, enforced.** An agent must declare `tools`, and its frontmatter may only contain `name`, `description`, `tools`, `model` and `color`. A team that sets `permissionMode`, `hooks`, `mcpServers` or any other key is rejected.
- **Checked downloads.** The registry is fetched over HTTPS only, without redirects, with a timeout and a 1 MiB limit per file. `registry.json` publishes a SHA-256 hash for every file, and a file that does not match is refused.
- **Project teams must be approved.** A team found in a project's `.byt/` folder may come from a cloned repository. Until you run `/byt trust <team>`, `/byt run` shows its agents and tools and asks before running it. Approvals are stored in `~/.byt/trust.json`, outside the repository. Teams you install or create yourself are approved automatically.
- **The lead file is data.** During `/byt run`, Claude uses the lead's prompt to coordinate, but ignores any instruction in it to change settings, install, push, fetch URLs or use extra tools.
- **Restart after installing.** Agents installed during a session are not loaded until Claude Code restarts. Until then, their tool limits cannot be enforced, so `/byt run` asks before falling back to general-purpose agents.

### Configuration & environment

| Variable | Effect |
| --- | --- |
| `BYT_HOME` | BYT data folder (default `~/.byt`) |
| `BYT_CLAUDE_DIR` | Claude Code folder used by the CLI; takes priority over `CLAUDE_CONFIG_DIR` (default `~/.claude`) |
| `BYT_REGISTRY` | Registry location, overrides `config registry` |
| `BYT_AUTHOR` | Default author of the teams you create (default: your system user name) |
| `BYT_DEBUG` | Print the stack trace of unexpected errors |
| `NO_COLOR` | Disable colours |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Enables the `agent-team` mode |

Files: `~/.byt/config.json` (configuration), `~/.byt/trust.json` (approved project teams), `~/.byt/state.json` (global scope) and `./.byt/state.json` (project scope). A state file lists the installed teams, whether they are enabled, and the `byt-*.md` agent files BYT wrote; `sync` never touches `byt-*.md` files it did not write. Project scope is unavailable when the current folder is your home folder. Team and agent names are kebab-case, 64 characters at most.

### Team format

```text
teams/my-team/
├── team.json
└── agents/
    ├── lead.md
    └── backend.md
```

```json
{
  "name": "my-team",
  "version": "1.0.0",
  "description": "What this team is for.",
  "author": "you",
  "tags": ["web"],
  "lead": "lead",
  "mode": "subagents",
  "agents": [
    { "name": "lead", "enabled": true },
    { "name": "backend", "enabled": true }
  ]
}
```

Each `agents/<name>.md` file is a standard [Claude Code subagent](https://code.claude.com/docs/en/sub-agents): a frontmatter with `name`, `description`, `tools` (required) and `model` (`color` is also allowed, nothing else), then the system prompt.

## Standalone CLI

`byt.mjs` also works without Claude Code, and every command accepts `--json`. Exceptions: `run` needs Claude Code and returns an error in a terminal, and `new` / `add-agent` with `--json` need their input through `--data`. JSON output is `{"ok": true, "command": "...", "data": ...}` on success and `{"ok": false, "error": {"code", "message", "hint", "data"}}` on failure (`hint` and `data` only when present).

```bash
node ~/.claude/skills/byt/byt.mjs list --json
node ~/.claude/skills/byt/byt.mjs new          # interactive wizard in the terminal
node ~/.claude/skills/byt/byt.mjs new my-team --data '{"description":"...","agents":[{"name":"lead"},{"name":"backend"}]}'
```

The CLI output and the installer messages are currently in French.

## Development

```bash
npm test                  # node:test, no dependencies (Node 18+)
npm run validate          # validate every team in teams/
npm run build:registry    # regenerate registry.json (maintainers only; CI does it on every push to main)
```

## License

[MIT](LICENSE)
