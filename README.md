# 🔗 ReferralBuddy

A feature-complete Discord referral tracking bot. Members get a personal invite link, earn points when their referrals grow in the server, and unlock reward roles at configurable thresholds — all logged in real-time to a dedicated channel.

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [How It Works — Logic & Architecture](#how-it-works)
3. [Prerequisites](#prerequisites)
4. [Discord Developer Portal Setup](#discord-developer-portal-setup)
5. [Installation & First Run](#installation--first-run)
6. [Bot Setup Wizard (`/setup`)](#bot-setup-wizard-setup)
7. [Commands Reference](#commands-reference)
8. [Level Bot Integration](#level-bot-integration)
9. [Deployment Options](#deployment-options)
   - [Bare Metal (Node + PM2)](#option-1-bare-metal-node--pm2)
   - [Docker](#option-2-docker)
   - [Docker Compose](#option-3-docker-compose)
   - [Podman (Rootless)](#option-4-podman-rootless)
   - [Podman Quadlet (systemd-native)](#option-5-podman-quadlet-systemd-native)
   - [Systemd Service (no containers)](#option-6-systemd-service-no-containers)
10. [Database Schema](#database-schema)
11. [Troubleshooting](#troubleshooting)
12. [Security Notes](#security-notes)

---

## Feature Overview

| Feature | Detail |
|---|---|
| **Invite tracking** | Snapshots all guild invites on startup. Diffs use-counts on every join to detect which invite was used. |
| **Personal referral links** | Each member gets a unique, permanent invite code via button or `/referral`. |
| **Points system** | `+1` on join · `+10` at Level 1 · `+100` at Level 10 |
| **Points ledger** | Every transaction is an immutable row with a timestamp. |
| **Reward roles** | Configurable point thresholds that auto-assign Discord roles. |
| **Fancy log channel** | Colour-coded embeds for joins, leaves, points, rewards, invites, and errors. |
| **Stats command** | Personal, member-lookup, and server-wide stats for any time period. |
| **Leaderboard** | Quick top-10 inviters and earners. |
| **Admin tools** | Add/remove/set points, view history, re-post the panel. |
| **Setup wizard** | Guided channel-message wizard — no JSON editing required. |

---

## How It Works

### Invite Detection

Discord does not tell you which invite a member used when they join. ReferralBuddy works around this by:

1. **On startup / guild join** — fetching every invite in every guild and storing `{ code, inviterId, uses }` in SQLite.
2. **On `guildMemberAdd`** — fetching a fresh snapshot and comparing use-counts. The invite whose count increased by 1 is the one the new member used.
3. **Referral invite fallback** — if an invite disappeared between the join event and the fetch (deleted/expired after use), the bot checks if exactly one known referral invite is now missing and attributes the join to its owner.

> **Limitation:** If two members join within milliseconds of each other using *different* invites, both counts increase simultaneously and the diff becomes ambiguous. This is a known Discord platform limitation that cannot be fully resolved. In practice it is extremely rare.

### Points Flow

```
Member A shares their referral link
         │
         ▼
Friend B clicks the link and joins the server
         │
         ├─► guildMemberAdd fires
         │       ├─ Diff invites → usedCode = A's code
         │       ├─ recordJoin(B, inviter=A)
         │       └─ awardPoints(A, +1, "Referral join")
         │
         ▼
Friend B reaches Level 1  (manual /level or automatic via level bot hook)
         │
         ├─► processMilestone(B, level=1)
         │       ├─ getInviterForMember(B) → A
         │       ├─ hasMilestone(B, A, 1)?  No → continue
         │       ├─ recordMilestone(B, A, 1)
         │       └─ awardPoints(A, +10, "Referral milestone: Level 1")
         │
         ▼
Friend B reaches Level 10
         └─► awardPoints(A, +100, "Referral milestone: Level 10")
```

### Reward Roles

After every `awardPoints` call the bot:
1. Fetches all configured reward thresholds for the guild (sorted ascending).
2. Checks the member's new total against each threshold.
3. For any threshold the member has crossed **and does not already have the role**, it calls `member.roles.add()` and logs the event.
4. Attempts a DM to the member announcing the reward.

### Setup Wizard

The `/setup` wizard uses Discord's **message collector** API. The bot sends an embed describing the next step, then waits up to **5 minutes** for the admin to type a response in the same channel. Responses are deleted automatically to keep the channel tidy. This approach was chosen because:

- Discord's modal dialogs (pop-up forms) are limited to 5 fields and expire after 3 minutes.
- Slash command options with 4+ required fields create a cluttered command picker.
- The channel wizard allows rich formatted instructions, validation feedback, and a review step before saving.

---

## Prerequisites

- **Node.js 18+** (LTS recommended)
- A Discord account with permission to create applications
- A Discord server where you have **Manage Server** permission

---

## Discord Developer Portal Setup

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**. Name it `ReferralBuddy`.

2. Go to **Bot** → click **Add Bot**.

3. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** — required to detect joins/leaves
   - ✅ **Message Content Intent** — required for the setup wizard's message collector

4. Copy your **Bot Token** — you'll need it in `.env`.

5. Go to **OAuth2 → URL Generator**. Select scopes:
   - `bot`
   - `applications.commands`

   Select bot permissions:
   - `Manage Roles` (to assign reward roles)
   - `Create Instant Invite` (to generate personal invite links)
   - `View Channels`
   - `Send Messages`
   - `Embed Links`
   - `Read Message History`

6. Open the generated URL and add the bot to your server.

7. Back in the portal, go to **General Information** and copy the **Application ID** — this is your `CLIENT_ID`.

---

## Installation & First Run

```bash
# 1. Clone the repository
git clone https://github.com/yourorg/referralbuddy.git
cd referralbuddy

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set DISCORD_TOKEN, CLIENT_ID, and optionally GUILD_ID

# 4. Register slash commands with Discord
#    Set GUILD_ID in .env for instant guild-scoped registration (recommended for setup)
#    Leave GUILD_ID blank to register globally (takes ~1 hour to propagate)
npm run deploy

# 5. Start the bot
npm start
```

You should see output like:
```
  ✔  Command loaded: /setup
  ✔  Command loaded: /referral
  ✔  Command loaded: /stats
  ✔  Command loaded: /leaderboard
  ✔  Command loaded: /level
  ✔  Command loaded: /admin
  ✔  Event registered: ready (once)
  ✔  Event registered: guildMemberAdd
  ...
[2024-01-15 12:00:00] ⚙️ Logged in as ReferralBuddy#1234 (123456789)
[2024-01-15 12:00:00] 📥 Cached 42 invites  ↳ My Server
[2024-01-15 12:00:00] ⚙️ ───── ReferralBuddy is ready ─────
```

---

## Bot Setup Wizard (`/setup`)

Run `/setup` in any channel where the bot can read and send messages. You must have **Manage Server** permission.

The wizard walks through 4 steps:

| Step | Prompt | Example answer |
|------|--------|----------------|
| 1 | **Log Channel** — where should activity logs go? | `#bot-logs` or channel ID |
| 2 | **Referral Channel** — where should the referral panel be posted? | `#referrals` |
| 3 | **Reward Roles** — one per line as `<points> @RoleName` | `100 @Recruiter` or `skip` |
| 4 | **Confirm** — review and save | `confirm` or `cancel` |

After confirmation the bot:
- Saves the config to the database.
- Posts the referral panel embed with a "Get My Referral Link" button in the referral channel.
- Logs the setup event to the log channel.

You can re-run `/setup` at any time to change channels or update reward roles.

---

## Commands Reference

### `/referral`
Get your personal referral invite link. The link is permanent and unique to you. Also accessible via the button in the referral panel.

---

### `/stats me [period] [from] [to]`
View your own referral stats.

### `/stats member <user> [period] [from] [to]`
View stats for another member.

### `/stats server [period] [from] [to]`
Server-wide top inviters, top earners, and totals.

**Period options:**

| Value | Description |
|-------|-------------|
| `All Time` | From the beginning of time (default) |
| `Today` | Last 24 hours |
| `This Week` | Last 7 days |
| `This Month` | Last 30 days |
| `Custom` | Specify `from` and `to` as `YYYY-MM-DD` |

**Custom example:**
```
/stats me period:Custom from:2024-01-01 to:2024-01-31
```

---

### `/leaderboard [period]`
Quick top-10 leaderboard for inviters and earners. Supports the same period options as `/stats`.

---

### `/level <member> <level>` *(admin)*
Manually trigger a level milestone for a member. Awards points to the member's inviter.

- Level ≥ 1 → `+10 pts` to the inviter
- Level ≥ 10 → `+100 pts` to the inviter

Milestones are idempotent — running the same command twice for the same member/level does nothing the second time.

---

### `/setup` *(admin)*
Run the interactive setup wizard. See [Bot Setup Wizard](#bot-setup-wizard-setup).

---

### `/admin points add <member> <amount> [reason]` *(admin)*
Manually add points to a member.

### `/admin points remove <member> <amount> [reason]` *(admin)*
Manually remove points from a member (capped at current total — no negatives).

### `/admin points set <member> <amount> [reason]` *(admin)*
Set a member's total to an exact value.

### `/admin points history <member>` *(admin)*
View the last 15 point transactions for a member, with timestamps.

### `/admin config` *(admin)*
Display the current configuration (channels, reward roles).

### `/admin resetpanel` *(admin)*
Re-post the referral panel in the configured referral channel (useful if it was accidentally deleted).

---

## Level Bot Integration

ReferralBuddy ships with a `processMilestone()` function in `src/commands/level.js` that handles the full milestone-award logic. You can call it automatically whenever a levelling bot assigns a level role, removing the need to run `/level` manually.

### Example: MEE6 / Arcane level role watcher

Add a `guildMemberUpdate` event listener (create `src/events/guildMemberUpdate.js`):

```js
// src/events/guildMemberUpdate.js
'use strict';

const { processMilestone } = require('../commands/level');

// Map role IDs → the level they represent
// Fill these in from your levelling bot's configuration
const LEVEL_ROLES = {
  '111111111111111111': 1,   // "Level 1" role ID → level 1
  '222222222222222222': 10,  // "Level 10" role ID → level 10
};

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember) {
    for (const [roleId, level] of Object.entries(LEVEL_ROLES)) {
      const hadRole = oldMember.roles.cache.has(roleId);
      const hasRole = newMember.roles.cache.has(roleId);

      if (!hadRole && hasRole) {
        // Member just received this level role
        await processMilestone(newMember.guild, newMember.id, level);
      }
    }
  },
};
```

This fires automatically whenever a member gains a new role, checks if it's a tracked level role, and awards points to the original inviter — completely hands-free.

---

## Deployment Options

### Option 1: Bare Metal (Node + PM2)

Best for: VPS/dedicated server without containers.

```bash
# Install PM2 globally
npm install -g pm2

# Start the bot
pm2 start deploy/ecosystem.config.js

# Save process list and generate startup script
pm2 save
pm2 startup   # follow the printed command to enable auto-start
```

**Useful PM2 commands:**
```bash
pm2 status               # see running processes
pm2 logs referralbuddy   # stream logs
pm2 restart referralbuddy
pm2 stop referralbuddy
```

---

### Option 2: Docker

```bash
# Build the image
docker build -t referralbuddy:latest .

# Run (database stored in a named volume)
docker run -d \
  --name referralbuddy \
  --restart unless-stopped \
  --env-file .env \
  -e DB_PATH=/app/data/referralbuddy.db \
  -v referralbuddy_data:/app/data \
  referralbuddy:latest

# Logs
docker logs -f referralbuddy
```

---

### Option 3: Docker Compose

```bash
# Copy and fill in .env
cp .env.example .env

# Start (builds image automatically)
docker compose up -d

# Logs
docker compose logs -f

# Stop
docker compose down

# Update (after pulling new code)
docker compose build --no-cache && docker compose up -d
```

---

### Option 4: Podman (Rootless)

Uses the included shell script — no root required.

```bash
# Make executable (already done in repo)
chmod +x deploy/podman-run.sh

# Build and run
./deploy/podman-run.sh
```

The script will:
1. Build the image with `podman build`.
2. Stop/remove any existing container with the same name.
3. Start a new rootless container with the database in `~/.local/share/referralbuddy/data`.
4. Optionally generate a systemd user unit so it starts on login.

---

### Option 5: Podman Quadlet (systemd-native)

Quadlet is the modern way to manage containers as systemd units (Podman ≥ 4.4, Fedora 37+, RHEL 9+).

```bash
# 1. Build the image first
podman build -t localhost/referralbuddy:latest .

# 2. Create the env file directory and copy your .env
mkdir -p ~/.config/referralbuddy
cp .env ~/.config/referralbuddy/referralbuddy.env

# 3. Create the data directory
mkdir -p ~/.local/share/referralbuddy/data

# 4. Install the Quadlet unit
mkdir -p ~/.config/containers/systemd
cp deploy/referralbuddy.container ~/.config/containers/systemd/

# 5. Reload systemd and start
systemctl --user daemon-reload
systemctl --user start referralbuddy
systemctl --user enable referralbuddy   # start on login

# Logs
journalctl --user -u referralbuddy -f
```

**Root / system-wide installation:**
```bash
cp deploy/referralbuddy.container /etc/containers/systemd/
# Edit the unit — replace %h with absolute paths
systemctl daemon-reload
systemctl enable --now referralbuddy
journalctl -u referralbuddy -f
```

---

### Option 6: Systemd Service (no containers)

For servers where you want Node running directly under systemd.

```bash
# 1. Create a dedicated user
sudo useradd -r -s /bin/false referralbuddy

# 2. Clone/copy the project
sudo mkdir -p /opt/referralbuddy
sudo cp -r . /opt/referralbuddy/
sudo chown -R referralbuddy:referralbuddy /opt/referralbuddy

# 3. Install dependencies as the service user
sudo -u referralbuddy bash -c "cd /opt/referralbuddy && npm ci --omit=dev"

# 4. Create the .env file
sudo cp /opt/referralbuddy/.env.example /opt/referralbuddy/.env
sudo nano /opt/referralbuddy/.env   # fill in your values

# 5. Install the service
sudo cp deploy/referralbuddy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now referralbuddy

# Logs
sudo journalctl -u referralbuddy -f
```

---

## Database Schema

The SQLite database lives at the path configured in `DB_PATH` (default: `./data/referralbuddy.db`).

| Table | Purpose |
|-------|---------|
| `guild_config` | One row per guild — log channel, referral channel, message ID |
| `reward_roles` | Configurable point thresholds → Discord role mappings |
| `invites` | Snapshot of every invite code seen (updated on every join) |
| `referral_invites` | The personal invite created for each member |
| `join_events` | Every join event with full attribution (joiner, inviter, code) |
| `points_log` | **Immutable** ledger — every point transaction with timestamp |
| `member_points` | Running totals cache for fast leaderboard queries |
| `level_milestones` | Idempotency guard — prevents double-awarding level bonuses |

All timestamps are stored as **Unix seconds** (integer). This makes range queries trivial and avoids timezone issues.

---

## Troubleshooting

**"Unknown Invite" on join — invites not being detected**
- Make sure the bot has the `Manage Guild` or `Manage Channels` permission (required to fetch invites).
- If your server has Community features enabled, vanity URL joins will always appear as "Unknown" since vanity URLs are not in the standard invite list.
- The bot must be online before the invite is created for it to be in the cache.

**Bot doesn't respond to slash commands**
- Run `npm run deploy` again to register commands.
- If using `GUILD_ID`, make sure it matches the server you're testing in.
- Without `GUILD_ID` (global commands), it can take up to 1 hour for commands to appear.

**"Missing Access" or "Missing Permissions" errors in logs**
- The bot's role must be above any roles it's trying to assign (reward roles). Drag the `ReferralBuddy` role above your reward roles in Server Settings → Roles.

**Setup wizard times out immediately**
- You have **5 minutes** to type each response. Make sure you're typing in the **same channel** where you ran `/setup`.
- Only the user who ran `/setup` can respond to the wizard.

**Level milestones not awarding points automatically**
- The `/level` command is manual by default. See [Level Bot Integration](#level-bot-integration) to wire up automatic detection.

**Database locked / WAL errors**
- Ensure only one bot instance is running at a time. The SQLite WAL mode handles concurrent reads but not multiple writers.

---

## Security Notes

- **Never commit `.env`** — it's in `.gitignore`. Use secrets management (GitHub Secrets, Vault, etc.) in CI/CD.
- The bot uses a **non-root user** inside the Docker/Podman image.
- The Podman Quadlet unit sets `NoNewPrivileges=true` and `ReadOnlyRootfs=true`.
- The systemd unit sets `PrivateTmp=yes` and `ProtectSystem=strict`.
- Only users with **Manage Server** permission can run `/setup`, `/level`, and `/admin`.
- The bot's role should be granted **only the permissions listed** in the invite URL above — do not use Administrator.
