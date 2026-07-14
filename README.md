# pi-vikunja

Vikunja task management for [pi](https://pi.dev). This extension registers tools so the assistant can list, create, and update tasks in your Vikunja instance.

## Install

```bash
pi install git:github.com/jwnx/pi-vikunja
```

Or try it once without installing:

```bash
pi -e git:github.com/jwnx/pi-vikunja
```

## Setup

### Option 1 — Environment variables

```bash
export VIKUNJA_URL="https://vikunja.example.com/api/v1"
export VIKUNJA_TOKEN="your-api-token"
```

### Option 2 — `~/.pi/agent/auth.json` (recommended)

```json
{
  "vikunja": {
    "type": "api_key",
    "key": "your-api-token"
  }
}
```

You can also use shell-command resolution (e.g. 1Password):

```json
{
  "vikunja": {
    "type": "api_key",
    "key": "!op read 'op://Employee/Vikunja API Token/password'"
  }
}
```

Or a raw string fallback:

```json
{
  "VIKUNJA_TOKEN": "!op read 'op://Employee/Vikunja API Token/password'"
}
```

The extension also supports storing the URL in the same credential's `env` object if you want to keep everything in one place.

## Features

| Tool / Command | What it does |
|---|---|
| `vikunja_list_projects` | List available projects |
| `vikunja_list_tasks` | List tasks, optionally filtered by project, done status, or search query |
| `vikunja_create_task` | Create a new task |
| `vikunja_update_task` | Update or mark a task done |
| `/vikunja-todos` | Slash command — list open tasks in a TUI widget |
| `/vikunja-config` | Show current extension configuration |

## License

MIT
