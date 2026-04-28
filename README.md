# 🔗 ReferralBuddy

![ReferralBuddy Banner](https://media.discordapp.net/attachments/1491698407830720694/1498616539274805379/Referralbuddy_banner_02.png?ex=69f1cee9&is=69f07d69&hm=d6f6d620b54779c226573435bde365861476902a2c0508b2e12fa527b31e3f43&=&format=webp&quality=lossless&width=1672&height=941)

A Discord referral tracking bot. Members click a button to receive their personal invite link via DM, earn points when referrals join and hit milestones, and admins get full visibility into attribution — all logged to a dedicated channel in real time.

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [How It Works — Logic & Architecture](#how-it-works--logic--architecture)
3. [Prerequisites](#prerequisites)
4. [Discord Developer Portal Setup](#discord-developer-portal-setup)
5. [Installation & First Run](#installation--first-run)
6. [Bot Configuration (`/setup`)](#bot-configuration-setup)
7. [Commands Reference](#commands-reference)
8. [Deployment Options](#deployment-options)
   - [Bare Metal (Node + PM2)](#option-1-bare-metal-node--pm2)
   - [Docker](#option-2-docker)
   - [Docker Compose](#option-3-docker-compose)
   - [Podman (Rootless)](#option-4-podman-rootless)
   - [Podman Quadlet (systemd-native)](#option-5-podman-quadlet-systemd-native)
   - [Systemd Service (no containers)](#option-6-systemd-service-no-containers)
9. [Database Schema](#database-schema)
10. [Troubleshooting](#troubleshooting)
11. [Security Notes](#security-notes)

---

## Feature Overview

| Feature | Detail |
|---|---|
| **Personal referral links** | Members click "Get My Referral Link" to receive a unique, permanent invite link via DM. Rate-limited to once per hour. |
| **Join tracking** | Diffs invite use-counts on every `guildMemberAdd` to determine which invite was used. Catalogues the joiner and awards the referrer 1 point. |
| **Self-referral protection** | Members cannot earn points from themselves — detected and blocked at join time. |
| **Rejoin protection** | Points are only awarded once per (referrer, joiner) pair. Rejoining never re-awards a point. |
| **Milestone roles** | When a referred member receives a configured role (e.g. from a levelling bot), their referrer earns the configured point value. |
| **Point ledger** | Every point change is stamped with a UTC timestamp and reason (`join`, `milestone_role`, `admin_adjust`). Powers all period-based leaderboards. |
| **Timed leaderboards** | Two-column public leaderboard (Top Inviters + Top Earners). Filter by Today, This Week, This Month, This Year, All Time, or a Custom date range. |
| **Personal stats** | `/stats` shows any member their points, rank, referred members, and who referred them. |
| **Role-based auth** | Admin commands are gated by a configurable role ID (`ADMIN_ROLE_ID`), not Discord's Administrator permission, so visibility is not affected for non-admins. |
| **Interactive panels** | `/setup` and `/debug` open embed panels with buttons — no subcommands to remember. |
| **Database backups** | Auto-backup on every startup with 10-backup retention. Manual trigger in the debug panel. |
| **Log channel** | All significant events are posted as colour-coded embeds to a configurable log channel. Falls back to console-only if not configured. |

---

## How It Works — Logic & Architecture

### Terminology

| Term | Meaning |
|---|---|
| **Member A** | The existing member who shared their referral link |
| **Friend B** | The new member who joined using Member A's link |
| **Referrer** | Synonym for Member A — the person who gets credited |

---

### `getReferrer(userId)` — Single Source of Truth

Every feature that needs to attribute points or check referral context calls a single internal function:

```
getReferrer(userId)
  └─ SELECT referrer_id FROM guild_members WHERE user_id = ?
     ├─ Returns referrer_id  (if a referrer is on record)
     └─ Returns null         (organic join, or member not yet catalogued)
```

**No event or command bypasses this function.** This ensures referrer resolution is consistent and auditable across the entire bot.

---

### Invite Detection

Discord does not tell you which invite a new member used. The bot resolves this by maintaining an **in-memory invite cache** (`Map<code, uses>`):

1. **On `ready`** — fetches all current guild invites and populates the cache.
2. **On `guildMemberAdd`** — fetches a fresh invite snapshot and diffs use-counts against the cache. The code whose count increased is the one used.
3. **Ambiguous join** — if zero or more than one invite changed simultaneously (bot was offline, or two members joined at once on different invites), the join is catalogued with `referrer_id = NULL` and a warning is posted to the log channel. No points are awarded.
4. **Cache update** — after attribution, the cache is rebuilt from the fresh snapshot.

---

### Join Flow

```
Friend B clicks Member A's referral link and joins
  │
  ├─ Diff invite cache  →  usedCode = A's invite
  │
  ├─ Ambiguous?  →  catalogue B with referrer=NULL, log warning, stop
  │
  ├─ Self-referral? (B.id === invite.created_by_id)
  │    └─  Log warning, stop — do not catalogue or award
  │
  ├─ Catalogue B: upsert guild_members with referrer_id = A.id
  │
  ├─ Skip points if:
  │    ├─ B is a bot
  │    ├─ Invite not found in invite_codes table
  │    ├─ Invite was created by a bot (created_by_bot = true)
  │    └─ B's guild_members row already has joined = 1 (rejoin guard)
  │
  ├─ Call getReferrer(B.id) — must match invite.created_by_id
  │    └─ Mismatch → log discrepancy, stop
  │
  └─ Award 1 point to A, set B.joined = 1, log success
       └─ Point written to point_ledger with reason = 'join'
```

---

### Milestone Role Flow

```
Friend B receives a role configured as a milestone role
  │
  ├─ Check role_reward_log (user_id, role_id) — already awarded? Stop.
  │
  ├─ Call getReferrer(B.id)
  │    └─ null → log "no referrer on record", stop
  │
  ├─ Award points_awarded to A in referral_points
  ├─ Write to point_ledger with reason = 'milestone_role'
  ├─ Insert into role_reward_log (idempotency)
  └─ Log success
```

---

### Referral Button Flow

```
Member A presses "Get My Referral Link"
  │
  ├─ Check referral_button_cooldowns (synchronous — before deferring)
  │    └─ Used within last hour? Reply with remaining cooldown, stop.
  │
  ├─ Defer interaction (acknowledges within 3 s, buys 15 min for async work)
  ├─ Update cooldown timestamp
  ├─ Fetch existing guild invites, upsert any of A's codes into invite_codes
  ├─ Create new invite (maxAge=0, maxUses=0, unique=true)
  ├─ Upsert new code: created_by_id = A.id, created_by_bot = false
  ├─ Update invite cache
  ├─ DM the invite URL to A
  └─ Reply ephemerally in the referral channel (fallback if DMs are closed)
```

---

### Leave Tracking

```
Member B leaves the server
  │
  ├─ Skip if bot
  ├─ Upsert left_members with current timestamp
  ├─ Set guild_members.has_left = 1
  │    NOTE: joined is NEVER reset to 0 — prevents re-award on rejoin
  └─ Log to log channel
```

---

### Startup Sequence

1. Rebuild in-memory invite cache from current guild invites
2. Sync invite codes into `invite_codes` table (`syncInviteCode` — never overwrites human-claimed records)
3. Catalogue all human guild members (without overwriting existing data)
4. Run automatic database backup
5. Post startup summary to log channel

---

## Prerequisites

- **Node.js 18 or later** (22 recommended)
- `better-sqlite3` is a native module — you need build tools:
  - **Linux/macOS:** `build-essential` / Xcode Command Line Tools
  - **Windows:** `npm install --global windows-build-tools`
- A Discord account with permission to create applications
- A server where you can manage roles

---

## Discord Developer Portal Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → name it `ReferralBuddy`.

2. **Bot tab** → **Reset Token** → copy the token (this is your `BOT_TOKEN`).

3. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** — required for join/leave/role events

4. **OAuth2 → URL Generator** — select scopes:
   - `bot`
   - `applications.commands`

   Bot permissions required:
   | Permission | Why |
   |---|---|
   | `Manage Guild` | Fetch the invite list (`guild.invites.fetch()`) |
   | `Create Instant Invite` | Generate personal referral links |
   | `View Channels` | See channels to send messages |
   | `Send Messages` | Post to log channel and referral channel |
   | `Embed Links` | Send embed log messages |

5. Open the generated OAuth2 URL and add the bot to your server.

6. **General Information** → copy the **Application ID** (this is your `CLIENT_ID`).

> ⚠️ The bot does **not** assign roles itself — no `Manage Roles` permission required. All role management is external (your levelling bot handles Friend B's roles; this bot only tracks them and awards points).

---

## Installation & First Run

```bash
# 1. Clone the repo
git clone https://github.com/setheon/ReferralBuddy.git
cd ReferralBuddy

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in BOT_TOKEN, CLIENT_ID, GUILD_ID, ADMIN_ROLE_ID

# 4. Register slash commands
#    With GUILD_ID set → instant (use this during setup)
#    Without GUILD_ID  → global, up to 1 hour to propagate
npm run deploy

# 5. Start the bot
npm start
```

**Expected startup console output:**
```
[timestamp] ℹ  Logged in as ReferralBuddy#0000 (id)
[timestamp] 🔗  Cached N invite(s) for YourServer
[timestamp] ℹ  Bot online. Catalogued N new member(s). N already existed.
[timestamp] 💾  Backup saved: backup-YYYY-MM-DDTHH-MM-SS.db
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ | Your Discord bot token |
| `CLIENT_ID` | ✅ | Your application's client ID (for deploy-commands) |
| `GUILD_ID` | Recommended | Guild ID for instant guild-scoped command registration |
| `ADMIN_ROLE_ID` | Recommended | Role ID whose members can use all admin commands. Falls back to Administrator permission if not set. |
| `DB_PATH` | Optional | Override the SQLite file path (default: `./data/referralbuddy.db`) |

---

## Bot Configuration (`/setup`)

`/setup` opens an interactive embed panel. No subcommands — use the buttons.

> Requires the role configured in `ADMIN_ROLE_ID`.

### First-time setup order

```
1. Click "Log Channel"      — select the channel where the bot posts logs
2. Click "Referral Channel" — select the channel where the panel lives
3. Click "Post Panel"       — posts the "Get My Referral Link" embed
4. Click "Add Milestone Role" — (optional) configure role-based point rewards
```

### Buttons

| Button | Action |
|---|---|
| 📋 **Log Channel** | Opens a channel picker. Saves immediately on selection. |
| 🔗 **Referral Channel** | Opens a channel picker. Saves immediately on selection. |
| 📢 **Post Panel** | Posts the referral panel embed (with "Get My Referral Link" button) into the configured referral channel. |
| ➕ **Add Milestone Role** | Opens a modal — type a role name or ID, then the points to award the referrer when any referred member receives that role. Supports servers with any number of roles. |
| ➖ **Remove Milestone Role** | Opens a modal — type the role name or ID to remove. |

---

## Commands Reference

### Public Commands

#### `/stats`
*Available to everyone*

Shows your own referral stats as a private embed:
- ⭐ Total points and all-time rank (with medal for top 3)
- 👥 List of everyone you've referred (as mentions)
- 🔗 Number of invite codes you've generated
- 📨 Who referred you

---

#### `/leaderboard [period] [start] [end]`
*Available to everyone — posts publicly in channel*

Two-column leaderboard embed showing **Top Inviters** (by join count) and **Top Earners** (by points).

| Option | Values | Default behaviour |
|---|---|---|
| `period` | Today · This Week · This Month · This Year · All Time · Custom | No option = This Month inviters + All Time earners |
| `start` | `YYYY-MM-DD` | Required only when period is Custom |
| `end` | `YYYY-MM-DD` | Defaults to today when period is Custom |

When a period is specified, both columns reflect that same period.

---

### Admin Commands

> All admin commands require the role set in `ADMIN_ROLE_ID`.

#### `/points user:@User`

Displays a user's current point total and who referred them.

---

#### `/referrals user:@User`

Shows how many invite codes the user has created and lists every member they've successfully referred.

---

#### `/setup`

Opens the interactive bot configuration panel. See [Bot Configuration](#bot-configuration-setup).

---

#### `/debug`

Opens the full admin debug panel. See [Debug Panel](#debug-panel) below.

---

### Debug Panel (`/debug`)

`/debug` opens an ephemeral embed showing a live status snapshot (members tracked, invite codes, total points, ping, uptime, memory) with three rows of action buttons.

> Requires `ADMIN_ROLE_ID`.

#### Row 1 — System

| Button | Action |
|---|---|
| 👥 **Catalogue Members** | Fetches all guild members and upserts any not yet in the database. Reports new vs existing count. |
| 💾 **Backup DB** | Triggers an immediate hot backup to `/backups`. Reports filename and timestamp. 10-backup retention applies. |
| 🔄 **Sync Invites** | Re-fetches all guild invites from Discord, syncs them into `invite_codes`, and rebuilds the in-memory cache. Use after the bot misses a period of activity. |
| 🧹 **Clear Cooldowns** | Wipes all referral button cooldowns. Useful for testing without waiting an hour. |
| ♻️ **Refresh** | Re-renders the debug embed in-place with live stats. |

#### Row 2 — Data

| Button | Action |
|---|---|
| 🔍 **Check Points** | Modal: enter a User ID → shows their point total and referrer. |
| 👥 **Check Referrals** | Modal: enter a User ID → shows their invite code count and full list of referred members. |
| ➕ **Adjust Points** | Modal: enter a User ID + amount → adds or subtracts points. Logged to the log channel. |
| 🔧 **Set Referrer** | Modal: enter a Member ID + Referrer ID → manually overrides the referrer on record. Used for dispute resolution. Self-referral is blocked. |

#### Row 3 — Debug Tools

| Button | Action |
|---|---|
| 🧪 **Test All Logs** | Fires one message per log type (`info → success → warn → error → points → invite → leave → backup → admin`) in order to your log channel, each labelled "DEBUG TESTING". |
| 📢 **Test Referral Ch.** | Posts a clearly-labelled DEBUG embed to the configured referral channel to verify it is reachable. |
| 📊 **Bot Status** | Shows a full status report: all DB table counts, point ledger size, invite cache size, uptime, WS latency, heap + RSS memory, Node.js version, and all config values. |
| ⚙️ **View Config** | Dumps every row in `bot_config` as a quick reference. |

---

## Deployment Options

### Option 1: Bare Metal (Node + PM2)

Best for a VPS or dedicated server.

```bash
npm install -g pm2

# Start
pm2 start src/index.js --name referralbuddy --env production

# Persist across reboots
pm2 save
pm2 startup   # follow the printed instruction

# Useful commands
pm2 status
pm2 logs referralbuddy
pm2 restart referralbuddy
pm2 stop referralbuddy
```

Create `ecosystem.config.js` for structured config:

```js
module.exports = {
  apps: [{
    name:        'referralbuddy',
    script:      'src/index.js',
    env_production: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '300M',
    restart_delay:      5000,
  }],
};
```

Then: `pm2 start ecosystem.config.js --env production`

---

### Option 2: Docker

Create a `Dockerfile` in the project root:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN addgroup -S bot && adduser -S bot -G bot
USER bot
CMD ["node", "src/index.js"]
```

Build and run:

```bash
docker build -t referralbuddy:latest .

docker run -d \
  --name referralbuddy \
  --restart unless-stopped \
  --env-file .env \
  -e DB_PATH=/app/data/referralbuddy.db \
  -v referralbuddy_data:/app/data \
  -v referralbuddy_backups:/app/backups \
  referralbuddy:latest

docker logs -f referralbuddy
```

---

### Option 3: Docker Compose

Create `compose.yaml`:

```yaml
services:
  referralbuddy:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DB_PATH: /app/data/referralbuddy.db
    volumes:
      - data:/app/data
      - backups:/app/backups

volumes:
  data:
  backups:
```

```bash
docker compose up -d
docker compose logs -f
docker compose down

# After updating code:
docker compose build --no-cache && docker compose up -d
```

---

### Option 4: Podman (Rootless)

Podman runs containers without root. The data directory lives in your home folder.

```bash
# Build
podman build -t localhost/referralbuddy:latest .

# Create named volumes for data persistence
podman volume create referralbuddy_data
podman volume create referralbuddy_backups

# Run
podman run -d \
  --name referralbuddy \
  --restart unless-stopped \
  --env-file ~/.config/referralbuddy/referralbuddy.env \
  -e DB_PATH=/app/data/referralbuddy.db \
  -v referralbuddy_data:/app/data:Z \
  -v referralbuddy_backups:/app/backups:Z \
  localhost/referralbuddy:latest

# View logs
podman logs -f referralbuddy
```

> The `:Z` volume flag sets the correct SELinux label on Fedora/RHEL hosts.

**Auto-start on login (user-level systemd):**

```bash
podman generate systemd --name referralbuddy --files --new
mkdir -p ~/.config/systemd/user
mv container-referralbuddy.service ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now container-referralbuddy
journalctl --user -u container-referralbuddy -f
```

---

### Option 5: Podman Quadlet (systemd-native)

Quadlet is the modern Podman-native approach — no separate service file needed. Requires **Podman ≥ 4.4** (Fedora 38+, RHEL 9.2+).

```bash
podman build -t localhost/referralbuddy:latest .
mkdir -p ~/.config/referralbuddy
cp .env ~/.config/referralbuddy/referralbuddy.env
```

Create `~/.config/containers/systemd/referralbuddy.container`:

```ini
[Unit]
Description=ReferralBuddy Discord Bot
After=network-online.target
Wants=network-online.target

[Container]
Image=localhost/referralbuddy:latest
ContainerName=referralbuddy

EnvironmentFile=%h/.config/referralbuddy/referralbuddy.env
Environment=DB_PATH=/app/data/referralbuddy.db

Volume=%h/.local/share/referralbuddy/data:/app/data:Z
Volume=%h/.local/share/referralbuddy/backups:/app/backups:Z

AutoUpdate=local

[Service]
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
mkdir -p ~/.local/share/referralbuddy/data
mkdir -p ~/.local/share/referralbuddy/backups

systemctl --user daemon-reload
systemctl --user enable --now referralbuddy
journalctl --user -u referralbuddy -f
```

---

### Option 6: Systemd Service (no containers)

```bash
sudo useradd -r -m -d /opt/referralbuddy -s /bin/false referralbuddy
sudo cp -r . /opt/referralbuddy/
sudo chown -R referralbuddy:referralbuddy /opt/referralbuddy
sudo -u referralbuddy bash -c "cd /opt/referralbuddy && npm ci --omit=dev"
sudo cp .env /opt/referralbuddy/.env
sudo chmod 600 /opt/referralbuddy/.env
```

Create `/etc/systemd/system/referralbuddy.service`:

```ini
[Unit]
Description=ReferralBuddy Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=referralbuddy
Group=referralbuddy
WorkingDirectory=/opt/referralbuddy
EnvironmentFile=/opt/referralbuddy/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10

# Hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/opt/referralbuddy/data /opt/referralbuddy/backups

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now referralbuddy
sudo journalctl -u referralbuddy -f
```

---

## Database Schema

SQLite database at `DB_PATH` (default: `./data/referralbuddy.db`). All timestamps are stored as UTC `datetime()` strings.

| Table | Primary Key | Purpose |
|---|---|---|
| `bot_config` | `key` | Key-value store for `log_channel_id`, `referral_channel_id` |
| `invite_codes` | `code` | Every tracked invite code with its owner (`created_by_id`) and whether the bot created it |
| `referral_points` | `user_id` | Running point total per user (fast reads for all-time lookups) |
| `point_ledger` | `id` (autoincrement) | Every point change with `delta`, `reason`, and `earned_at` timestamp — powers all period leaderboards |
| `guild_members` | `user_id` | Join/leave status and referrer for every tracked member |
| `left_members` | `user_id` | Departure log with timestamp |
| `role_point_rewards` | `role_id` | Milestone roles that trigger point awards to referrers |
| `role_reward_log` | `(user_id, role_id)` | Idempotency guard — prevents awarding the same milestone role reward twice |
| `referral_button_cooldowns` | `user_id` | Tracks last button press time for rate limiting |
| `db_backup_log` | `rowid` | Record of every backup created (used for rolling retention) |

### Key design decisions

- **`guild_members.joined` is never reset to 0 on leave.** This is the rejoin fraud guard — once a referrer is credited for a member joining, that credit is permanent regardless of how many times the member leaves and returns.
- **`role_reward_log` is a composite-key table.** One row per `(user, role)` pair. Inserting a duplicate silently no-ops (`INSERT OR IGNORE`). Role reward attribution is fully idempotent even if Discord fires `guildMemberUpdate` multiple times.
- **`referral_points` floors at 0.** The `addPoints` and `setPoints` functions use `MAX(0, ...)` — points can never go negative.
- **`point_ledger` is append-only.** The running total in `referral_points` is updated atomically alongside every ledger write. Period leaderboards always query the ledger; all-time leaderboards always query `referral_points` for speed.
- **`getReferrer` is the only referrer lookup.** No event or command queries `guild_members.referrer_id` directly. If referrer resolution logic ever needs to change, it changes in one place.
- **`syncInviteCode` vs `upsertInviteCode`.** Bot restarts use `syncInviteCode`, which preserves any human-claimed record (`created_by_bot = 0`). The referral button uses `upsertInviteCode`, which always overwrites. This ensures a restart never clobbers the real member ID stored when someone clicked "Get My Referral Link".

---

## Troubleshooting

**Joins show as ambiguous — "Could not determine invite code"**
- The bot was offline when the member joined, so the invite cache was stale.
- Two members joined simultaneously on different invites — the diff is ambiguous.
- Use **Debug → Set Referrer** to manually attribute the join.
- Use **Debug → Sync Invites** to force-rebuild the invite cache from Discord.

**No points awarded after a valid join**
- Check that **Server Members Intent** is enabled in the Developer Portal.
- Confirm the invite code appears in `invite_codes` with the correct `created_by_id`.
- If `guild_members.joined` is already `1` for the joining member, they are a rejoin — no points are awarded by design.

**Milestone role rewards not firing**
- Open `/setup` and verify the role is listed under 🏆 Milestone Roles.
- Ensure **Server Members Intent** is enabled — required for `guildMemberUpdate`.
- Check the log channel for a "no referrer on record" message. Use **Debug → Set Referrer** to fix the attribution.

**"Get My Referral Link" button shows a cooldown immediately**
- The member pressed the button within the last hour. The reply shows the exact remaining wait time.
- Admins can clear all cooldowns via **Debug → Clear Cooldowns**.

**Referral link not arriving in DMs**
- The member's DM settings may block messages from server members.
- The link is always shown as an ephemeral reply in the referral channel as a fallback.

**Slash commands don't appear in Discord**
- Run `npm run deploy` to register them.
- With `GUILD_ID`: instant. Without `GUILD_ID` (global): up to 1 hour.
- Commands are visible to all members but only executable by holders of `ADMIN_ROLE_ID` (except `/stats` and `/leaderboard`, which are public).

**Log channel not receiving messages**
- Run **Debug → Test All Logs** to fire a test message of every log type.
- Ensure the bot has `Send Messages` and `Embed Links` permissions in the log channel.

**Database errors on startup**
- Only one bot process should access the database at a time.
- Ensure the `data/` and `backups/` directories are writable by the process user.
- Restore from the latest file in `backups/` if the database is corrupted.

---

## Security Notes

- **Never commit `.env`** — it is in `.gitignore`. Use environment secrets in your CI/CD system.
- The Podman and Docker setups run as a **non-root user** inside the container.
- The systemd unit uses `NoNewPrivileges`, `PrivateTmp`, and `ProtectSystem=strict`.
- Admin commands are gated by `ADMIN_ROLE_ID`. The role should be assigned only to trusted staff. If `ADMIN_ROLE_ID` is not set, the bot falls back to requiring the Discord **Administrator** permission.
- The bot **never assigns Discord roles**. It only reads role events. This limits blast radius if the bot token is ever compromised.
- All point adjustments made via the debug panel are logged to the log channel with the admin's user ID.
