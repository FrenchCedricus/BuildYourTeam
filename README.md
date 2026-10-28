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

The installer copies the skill to `~/.claude/skills/byt/` and creates `~/.byt/`. Restart Claude Code if `/byt` does not show up.

## Quick start

```text
/byt list --available          # browse the registry
/byt install software-dev      # install a team
/byt info software-dev         # see its agents, tools and models
/byt run software-dev "Fix the failing login test"
```

## Commands

| Command | What it does |
| --- | --- |
| `/byt help` | Show help |
| `/byt list` | Installed teams, with active and inactive agents |
| `/byt list --available` | Teams available in the registry |
| `/byt search <word>` | Search the registry by name, description or tag |
| `/byt info <team>` | Details of a team and its agents |
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
| `/byt validate [team]` | Check a team's files |

**Options:** `--project` / `--global` (where to install), `--from <team>` (start `new` from an existing team), `--json` (machine-readable output), `--force`.

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
| `brainstorming` | Ideas and decisions | facilitator, visionary, critic, pragmatist, synthesizer |

Each agent gets only the tools its role needs. Leads, reviewers and auditors are read-only. Only the roles that must run commands get `Bash`, and only research roles get web access.

## Create your own team

```text
/byt new
```

The wizard asks a few questions with clickable answers: name and goal, starting point, project type, roles, access level and model for each agent, and mode. Every question has a recommended answer, so you can accept everything in a few clicks. Claude then writes the system prompts and BYT validates the team.

Teams you create are stored in the current project (`.byt/teams/`), or in `~/.byt/teams/` with `--global`. They are marked as local, so `update` never overwrites them.

Want to share yours? See [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

- **One skill, one script.** `/byt` is a skill that hands every deterministic command to `byt.mjs`, a dependency-free Node.js script. Only `run`, `new` and `add-agent` use Claude's reasoning.
- **Safe sync.** Only *active* agents are copied to `~/.claude/agents/` (or `.claude/agents/` in project mode), named `byt-<team>-<agent>.md`. BYT never touches agent files it did not create.
- **Two modes.** `subagents` (default): Claude acts as the lead and delegates to subagents. `agent-team`: the agents become teammates in an [agent team](https://code.claude.com/docs/en/agent-teams). This mode is experimental and needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- **Configurable registry.** The default registry is this repository. Point BYT at your own with `node ~/.claude/skills/byt/byt.mjs config registry <url>`.

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

Each `agents/<name>.md` file is a standard [Claude Code subagent](https://code.claude.com/docs/en/sub-agents): a frontmatter with `name`, `description`, `tools` and `model`, then the system prompt.

## Standalone CLI

`byt.mjs` also works without Claude Code, and every command accepts `--json`:

```bash
node ~/.claude/skills/byt/byt.mjs list --json
node ~/.claude/skills/byt/byt.mjs new          # interactive wizard in the terminal
node ~/.claude/skills/byt/byt.mjs new my-team --data '{"description":"...","agents":[{"name":"lead"},{"name":"backend"}]}'
```

The CLI output is currently in French.

## Development

```bash
npm test                  # node:test, no dependencies
npm run validate          # validate every team in teams/
npm run build:registry    # regenerate registry.json
```

## License

[MIT](LICENSE)
