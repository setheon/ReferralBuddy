# 🔗 ReferralBuddy

A Discord referral tracking bot. Members get a personal invite link, earn points when their referrals level up in the server, and unlock reward roles at configurable thresholds — all logged in real-time to a dedicated channel.

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [How It Works — Logic & Architecture](#how-it-works)
3. [Prerequisites](#prerequisites)
4. [Discord Developer Portal Setup](#discord-developer-portal-setup)
5. [Installation & First Run](#installation--first-run)
6. [Setup Wizard (`/setup`)](#setup-wizard-setup)
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
| **Invite tracking** | Snapshots all guild invites on startup. Diffs use-counts on every join to attribute which invite was used. |
| **Personal referral links** | Each member gets a unique, permanent invite link via button or `/referral`. |
| **Join points** | Inviter (Member A) earns **+1 pt** when their referral (Friend B) joins. |
| **Level role points** | When Friend B receives a configured level role from your levelling bot, Member A earns the points you set for that role. Supports 0–20 level roles per server, each with custom point values. |
| **Points ledger** | Every transaction is an immutable row with a timestamp — nothing is ever overwritten. |
| **Reward roles** | Member A can earn Discord roles when their own point total crosses configurable thresholds. |
| **Fancy log channel** | Colour-coded embeds for joins, leaves, points, reward grants, invites, and errors. |
| **Stats command** | Personal, member-lookup, and server-wide stats for any time period. |
| **Leaderboard** | Quick top-10 inviters and earners. |
| **Admin tools** | Manually add/remove/set points, view history, re-post the referral panel. |
| **Setup wizard** | 5-step guided channel wizard — no config files to edit. |

---

## How It Works

### Terminology

| Term | Meaning |
|---|---|
| **Member A** | The existing server member who shared their referral link |
| **Friend B** | The new member who joined using Member A's link |
| **Level role** | A role assigned by your levelling bot (e.g. MEE6, Arcane) when Friend B reaches a level |
| **Reward role** | A role ReferralBuddy assigns to Member A when their points hit a threshold |

---

### Invite Detection

Discord does not tell you which invite a new member used when they join. ReferralBuddy works around this by:

1. **On startup / bot added to guild** — fetches every invite and stores `{ code, inviterId, uses }` in SQLite.
2. **On `guildMemberAdd`** — fetches a fresh snapshot and diffs the use-counts. The invite whose count increased by 1 is the one the new member used.
3. **Referral invite fallback** — if an invite disappeared between the join event and the fetch (deleted or expired), the bot checks whether exactly one known referral invite is now missing and attributes the join to its owner.

> **Known limitation:** If two members join within milliseconds of each other on *different* invites, both use-counts increment simultaneously and the diff becomes ambiguous. This is a Discord platform constraint that cannot be fully resolved. It is extremely rare in practice.

---

### Points Flow

```
Member A shares their referral link
         │
         ▼
Friend B clicks the link and joins the server
         │
         ├─► guildMemberAdd fires
         │       ├─ Diff invites  →  usedCode = A's referral code
         │       ├─ recordJoin(B, inviter=A, code)
         │       └─ awardPoints(A, +1, "Referral join")
         │
         ▼
Your levelling bot assigns Friend B a level role
(e.g. "Level 1" role from MEE6)
         │
         ├─► guildMemberUpdate fires
         │       ├─ Detect role added to B
         │       ├─ getLevelRoleByRoleId(roleId)  →  matched, points = 10
         │       ├─ getInviterForMember(B)  →  A
         │       ├─ hasMilestone(B, A, roleId)?  No → continue
         │       ├─ recordMilestone(B, A, roleId)
         │       └─ awardPoints(A, +10, "Level role: Level 1")
         │
         ▼
Friend B later receives the "Level 10" role
         │
         ├─► guildMemberUpdate fires
         │       ├─ getLevelRoleByRoleId(roleId)  →  matched, points = 100
         │       ├─ hasMilestone(B, A, roleId)?  No → continue
         │       ├─ recordMilestone(B, A, roleId)
         │       └─ awardPoints(A, +100, "Level role: Level 10")
         │
         ▼
Member A's total points cross a reward threshold
         └─► checkRewardRoles(A)
                 ├─ A has 111 pts, threshold is 100  →  assign reward role
                 └─ DM A: "You've unlocked @Recruiter!"
```

**Key points:**

- Points always go to **Member A** (the inviter), never to Friend B.
- Each level role milestone is **idempotent** — if Friend B somehow receives the same role twice, points are only awarded once.
- Level roles are configured per-server. There is no hardcoded "Level 1 = 10 pts" logic — you define the roles and points yourself.
- Reward roles (for Member A) are separate from level roles (for Friend B) and are entirely optional.

---

### Reward Roles

After every `awardPoints` call the bot:

1. Fetches all configured reward role thresholds for the guild (sorted ascending by points).
2. Compares Member A's new total against each threshold.
3. For any threshold Member A has now crossed **and does not already have the role**, it assigns the role and logs the event.
4. Attempts a DM to Member A announcing the reward.

---

### Setup Wizard

The `/setup` wizard uses Discord's **message collector** API. The bot sends an embed describing the current step, then waits up to **5 minutes** for the admin to type a response in the same channel. Responses are deleted automatically. This approach was chosen because:

- Discord modal dialogs are limited to 5 fields and expire after 3 minutes.
- Slash command options with multiple required fields create a cluttered picker.
- The channel wizard allows rich formatted instructions, inline validation, and a review-before-save step.

---

## Prerequisites

- **Node.js 22.5 or later** — the bot uses the built-in `node:sqlite` module (no native compilation required)
- A Discord account with permission to create applications
- A Discord server where you have **Manage Server** permission

---

## Discord Developer Portal Setup

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**. Name it `ReferralBuddy`.

2. Go to **Bot** → click **Reset Token** and copy your token.

3. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** — required to detect joins, leaves, and role changes
   - ✅ **Message Content Intent** — required for the setup wizard's message collector

4. Go to **OAuth2 → URL Generator**. Select scopes:
   - `bot`
   - `applications.commands`

   Select bot permissions:
   - `Manage Roles` — to assign reward roles to Member A
   - `Manage Guild` — **required** to fetch the invite list (without this, invite tracking does not work)
   - `Create Instant Invite` — to generate personal referral links
   - `View Channels`
   - `Send Messages`
   - `Embed Links`
   - `Read Message History`

5. Open the generated URL and add the bot to your server.

6. Go to **General Information** and copy the **Application ID** — this is your `CLIENT_ID`.

> ⚠️ The bot's role must be positioned **above any reward roles** it needs to assign. Drag the ReferralBuddy role up in **Server Settings → Roles** after inviting the bot.

---

## Installation & First Run

```bash
# 1. Clone or unzip the project
cd referralbuddy

# 2. Install dependencies (discord.js + dotenv only — no native modules)
npm install

# 3. Configure environment
cp .env.example .env
nano .env   # fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID

# 4. Register slash commands
#    GUILD_ID set  → instant registration (use this during setup)
#    GUILD_ID blank → global registration (up to 1 hour to propagate)
npm run deploy

# 5. Start the bot
npm start
```

Expected startup output:
```
  ✔  Command loaded: /setup
  ✔  Command loaded: /referral
  ✔  Command loaded: /stats
  ✔  Command loaded: /leaderboard
  ✔  Command loaded: /levelroles
  ✔  Command loaded: /postpanel
  ✔  Command loaded: /admin
  ✔  Event registered: ready (once)
  ✔  Event registered: guildMemberAdd
  ✔  Event registered: guildMemberUpdate
  ...
[2024-01-15 12:00:00] ⚙️  Logged in as ReferralBuddy#1234
[2024-01-15 12:00:00] 📥  Cached 42 invites  ↳ My Server
[2024-01-15 12:00:00] ⚙️  ───── ReferralBuddy is ready ─────
```

---

## Setup Wizard (`/setup`)

Run `/setup` in any channel the bot can read and send messages in. Requires **Manage Server** permission.

The wizard walks through **5 steps**:

| Step | What it asks | Format | Skip? |
|------|-------------|--------|-------|
| 1 | **Log Channel** — where to post activity logs | `#channel` or channel ID | No |
| 2 | **Referral Channel** — where to post the referral panel | `#channel` or channel ID | No |
| 3 | **Level Roles** — which levelling bot roles award points to the inviter | `<role_id or @mention> <points>` per line | Yes — type `skip` |
| 4 | **Reward Roles** — which roles Member A earns at point thresholds | `<points> @RoleName` per line | Yes — type `skip` |
| 5 | **Confirm** — review all settings and save | `confirm` or `cancel` | — |

### Step 3 — Level Roles example input

```
123456789012345678 10
987654321098765432 100
```

Or using role mentions (copy from Discord):

```
@Level 1 10
@Level 10 100
```

Each line means: "when Friend B receives this role, award the inviter this many points."

- Minimum: **0 roles** (type `skip`)
- Maximum: **20 roles**
- Points can be changed later with `/levelroles add` (remove then re-add the role)

### Step 4 — Reward Roles example input

```
50   @Newcomer Recruiter
250  @Active Recruiter
1000 @Elite Recruiter
```

Each line means: "when Member A reaches this many total points, assign them this role."

After confirming, the bot saves the config and automatically posts the referral panel embed in the referral channel.

---

## Commands Reference

### Member commands

---

#### `/referral`
Get your personal referral invite link. The link is permanent and unique to you. Also accessible by clicking the button in the referral panel embed.

---

#### `/stats me [period] [from] [to]`
View your own referral stats — total points, period points, total invites, and period invites.

#### `/stats member <user> [period] [from] [to]`
View the same stats for any other member.

#### `/stats server [period] [from] [to]`
Server-wide leaderboard — top inviters, top earners, total joins, and total points awarded for the period.

**Period options:**

| Option | Coverage |
|--------|----------|
| `All Time` | Since the bot was set up (default) |
| `Today` | Last 24 hours |
| `This Week` | Last 7 days |
| `This Month` | Last 30 days |
| `Custom` | Specify `from` and `to` as `YYYY-MM-DD` |

Custom example:
```
/stats me period:Custom from:2024-01-01 to:2024-01-31
```

---

#### `/leaderboard [period]`
Quick top-10 embed showing the best inviters and highest point earners for the selected period.

---

### Admin commands

All admin commands require **Manage Server** permission.

---

#### `/setup`
Run the interactive 5-step setup wizard. Safe to re-run at any time — it overwrites the existing config on confirm.

---

#### `/levelroles add <role> <points>`
Add a level role to watch. When any member receives this role from your levelling bot, their inviter earns the specified points.

```
/levelroles add role:@Level 1 points:10
/levelroles add role:@Level 10 points:100
```

- Up to **20 level roles** per server
- `points` must be between 1 and 100,000
- Adding a role that is already tracked returns an error — remove it first if you want to change the points

---

#### `/levelroles remove <role>`
Stop tracking a level role. Existing milestone records are kept (so points already awarded won't be double-awarded if the role is re-added), but no new points will be awarded when members receive this role.

---

#### `/levelroles list`
Display all currently tracked level roles with their point values and slot usage (e.g. `3/20 slots used`).

---

#### `/levelroles clear`
Remove all tracked level roles at once.

---

#### `/postpanel [channel]`
Re-post the referral panel embed with the "Get My Referral Link" button.

- **No `channel` option** — posts to the configured referral channel
- **With `channel` option** — posts to the specified channel and updates the config to use it going forward

Useful when the original panel message was deleted or the channel was recreated.

---

#### `/admin points add <member> <amount> [reason]`
Manually add points to a member. Logged to the points ledger with the reason.

#### `/admin points remove <member> <amount> [reason]`
Manually remove points. Capped at the member's current total — cannot go negative.

#### `/admin points set <member> <amount> [reason]`
Set a member's total to an exact value. The difference is recorded as a single ledger entry.

#### `/admin points history <member>`
View the last 15 point transactions for a member, with timestamps and reasons.

#### `/admin config`
Display the current server configuration — log channel, referral channel, level roles, and reward roles.

#### `/admin resetpanel`
Alias for reposting the referral panel (same as `/postpanel` with no options).

---

## Level Bot Integration

ReferralBuddy listens to `guildMemberUpdate` and checks every role addition against the level roles you've configured. **No code changes are needed** — the integration is entirely database-driven.

### How to set it up

1. In your levelling bot (MEE6, Arcane, Lurkr, etc.), configure it to assign a Discord role when a member hits a specific level.
2. Copy the role IDs for those roles.
3. Run `/levelroles add` for each one, specifying the points to award to the inviter.

That's it. From that point on, whenever any member receives one of those roles, ReferralBuddy automatically finds who invited them and awards the points.

### Example — MEE6 setup

In MEE6 dashboard, create role rewards:
- Level 1 → assigns role `Level 1` (ID: `111111111111111111`)
- Level 10 → assigns role `Level 10` (ID: `222222222222222222`)

Then in Discord:
```
/levelroles add role:@Level 1  points:10
/levelroles add role:@Level 10 points:100
```

### Idempotency

Each level role milestone is recorded in the `level_milestones` table keyed by `(guild_id, member_id, inviter_id, role_id)`. If the same role is removed and re-added to Friend B, or the event fires twice, the points are only awarded once.

### Any number of milestones

There is no hardcoded "Level 1" or "Level 10" concept. You can configure any roles as milestones — a server could have 15 different level roles each awarding different amounts to the inviter.

---

## Deployment Options

### Option 1: Bare Metal (Node + PM2)

Best for: VPS or dedicated server without containers.

```bash
npm install -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup   # follow the printed instruction
```

Useful commands:
```bash
pm2 status
pm2 logs referralbuddy
pm2 restart referralbuddy
pm2 stop referralbuddy
```

---

### Option 2: Docker

```bash
docker build -t referralbuddy:latest .

docker run -d \
  --name referralbuddy \
  --restart unless-stopped \
  --env-file .env \
  -e DB_PATH=/app/data/referralbuddy.db \
  -v referralbuddy_data:/app/data \
  referralbuddy:latest

docker logs -f referralbuddy
```

---

### Option 3: Docker Compose

```bash
cp .env.example .env   # fill in your values

docker compose up -d
docker compose logs -f
docker compose down

# After pulling updated code:
docker compose build --no-cache && docker compose up -d
```

---

### Option 4: Podman (Rootless)

```bash
chmod +x deploy/podman-run.sh
./deploy/podman-run.sh
```

The script builds the image, stops any existing container, starts a new rootless container with the database in `~/.local/share/referralbuddy/data`, and optionally generates a systemd user unit for auto-start on login.

---

### Option 5: Podman Quadlet (systemd-native)

Requires Podman ≥ 4.4 (Fedora 37+, RHEL 9+).

```bash
# Build image
podman build -t localhost/referralbuddy:latest .

# Set up config and data directories
mkdir -p ~/.config/referralbuddy
cp .env ~/.config/referralbuddy/referralbuddy.env
mkdir -p ~/.local/share/referralbuddy/data

# Install Quadlet unit
mkdir -p ~/.config/containers/systemd
cp deploy/referralbuddy.container ~/.config/containers/systemd/

# Start
systemctl --user daemon-reload
systemctl --user enable --now referralbuddy

# Logs
journalctl --user -u referralbuddy -f
```

For root/system-wide:
```bash
cp deploy/referralbuddy.container /etc/containers/systemd/
# Edit the unit — replace %h with absolute paths
systemctl daemon-reload
systemctl enable --now referralbuddy
```

---

### Option 6: Systemd Service (no containers)

```bash
# Create a dedicated system user
sudo useradd -r -s /bin/false referralbuddy

# Copy project files
sudo mkdir -p /opt/referralbuddy
sudo cp -r . /opt/referralbuddy/
sudo chown -R referralbuddy:referralbuddy /opt/referralbuddy

# Install dependencies
sudo -u referralbuddy bash -c "cd /opt/referralbuddy && npm ci --omit=dev"

# Create .env
sudo cp /opt/referralbuddy/.env.example /opt/referralbuddy/.env
sudo nano /opt/referralbuddy/.env

# Install and enable the service
sudo cp deploy/referralbuddy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now referralbuddy

sudo journalctl -u referralbuddy -f
```

---

## Database Schema

SQLite database at `DB_PATH` (default: `./data/referralbuddy.db`). All timestamps are Unix seconds.

| Table | Purpose |
|-------|---------|
| `guild_config` | One row per guild — log channel, referral channel, panel message ID |
| `level_roles` | Roles that award points to the inviter when Friend B receives them. Each row has a `role_id` and `points` value. Replaces the old hardcoded level 1/10 system. |
| `reward_roles` | Point thresholds that auto-assign roles to Member A |
| `invites` | Snapshot of every invite code seen in the guild (use-count updated on every join) |
| `referral_invites` | The personal invite link generated for each member |
| `join_events` | Every join event with full attribution: joiner, inviter, invite code, timestamp |
| `points_log` | **Immutable** points ledger — every transaction with reason, related member, and timestamp |
| `member_points` | Running totals cache per member for fast leaderboard queries |
| `level_milestones` | Idempotency guard — `(guild_id, member_id, inviter_id, role_id)` primary key prevents double-awarding |

---

## Troubleshooting

**Invites show as "Unknown / Organic" on every join**
- The bot needs `Manage Guild` permission to call `guild.invites.fetch()`. Without it invite tracking is completely broken.
- The bot must have been online when the invite was created. Invites created while the bot was offline won't be in the cache until the next restart.
- Vanity URL joins (`discord.gg/yourserver`) always appear as Unknown — Discord does not expose vanity URL usage in the invite API.

**Level role points are not being awarded**
- Confirm the role is tracked: `/levelroles list`
- Make sure the bot has `Server Members Intent` enabled in the Developer Portal under Privileged Gateway Intents.
- The `guildMemberUpdate` event only fires if the bot can see the member — ensure it has View Channels access.
- Check the log channel for any error embeds.

**Slash commands don't appear**
- Run `npm run deploy` to register them.
- With `GUILD_ID` set: commands appear instantly.
- Without `GUILD_ID` (global): can take up to 1 hour.
- After adding new commands (like `/levelroles`, `/postpanel`) you must re-run `npm run deploy`.

**Reward roles not being assigned**
- The bot's role must be **above** the reward role in the role hierarchy. Go to Server Settings → Roles and drag ReferralBuddy above any roles it should assign.

**Setup wizard times out**
- You have 5 minutes per step. Type your response in the **same channel** where you ran `/setup`.
- Only the user who ran `/setup` can respond.

**Referral panel button stopped working**
- The panel message may have been deleted. Run `/postpanel` to re-post it.

**Database errors on startup**
- Ensure only one instance of the bot is running. SQLite WAL mode supports concurrent reads but only a single writer.
- Check that the `data/` directory is writable by the process user.

---

## Security Notes

- **Never commit `.env`** — it is in `.gitignore`. Use environment secrets in CI/CD (GitHub Actions secrets, Vault, etc.).
- The Docker/Podman image runs as a **non-root user**.
- The Podman Quadlet unit sets `NoNewPrivileges=true` and `ReadOnlyRootfs=true`.
- The systemd unit sets `PrivateTmp=yes` and `ProtectSystem=strict`.
- Only members with **Manage Server** permission can run `/setup`, `/levelroles`, `/postpanel`, and `/admin`.
- Grant the bot only the permissions listed above — **do not use Administrator**.
