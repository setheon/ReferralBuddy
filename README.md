# 🔗 ReferralBuddy

A Discord referral tracking bot. Members click a button to get a personal invite link, earn points when referrals join and level up, and admins get full visibility into who invited whom — all logged to a dedicated channel in real time.

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
| **Personal referral links** | Members click "Get My Referral Link" to receive a unique, permanent invite link. Rate-limited to once per hour. |
| **Join tracking** | Diffs invite use-counts on every `guildMemberAdd` to determine which invite was used. Catalogues the joiner and awards the referrer 1 point. |
| **Self-referral protection** | Members cannot earn points from themselves — detected and blocked at join time. |
| **Rejoin protection** | Points are only awarded once per (referrer, joiner) pair. Rejoining never re-awards a point. |
| **Role-based point rewards** | When a referred member receives a configured role (e.g. from a levelling bot), their referrer earns the configured point value. |
| **Admin tools** | Check, adjust, and view the leaderboard. Manually set referrers for dispute resolution. |
| **Database backups** | Auto-backup on every startup with 10-backup retention. Manual trigger available via `/backup-db`. |
| **Member catalogue** | Full guild catalogue on startup and on demand — members are tracked without losing any existing data. |
| **Log channel** | All significant events are posted as embeds to a configurable log channel. Falls back to console-only if not configured. |

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
```

---

### Role Reward Flow

```
Friend B receives a role configured in role_point_rewards
  │
  ├─ Check role_reward_log (user_id, role_id) — already awarded? Stop.
  │
  ├─ Call getReferrer(B.id)
  │    └─ null → log "no referrer on record", stop
  │
  ├─ Award points_awarded to A in referral_points
  ├─ Insert into role_reward_log (idempotency)
  └─ Log success
```

---

### Referral Button Flow

```
Member A presses "Get My Referral Link"
  │
  ├─ Check referral_button_cooldowns
  │    └─ Used within last hour? Reply with exact remaining cooldown, stop.
  │
  ├─ Update cooldown timestamp
  ├─ Fetch existing guild invites, upsert any of A's codes into invite_codes
  ├─ Create new invite (maxAge=0, maxUses=0, unique=true)
  ├─ Upsert new code into invite_codes with created_by_id = A.id, created_by_bot = false
  ├─ Update invite cache
  ├─ Reply ephemerally to A with invite URL
  ├─ Post invite URL in referral channel
  └─ Log to log channel
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
2. Sync invite codes into `invite_codes` table
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
- A server where you have **Administrator** permission

---

## Discord Developer Portal Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → name it `ReferralBuddy`.

2. **Bot tab** → **Reset Token** → copy the token (this is your `BOT_TOKEN`).

3. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** — required for join/leave/role events
   - ✅ **Message Content Intent** — required if you plan to extend the bot

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
# Edit .env — fill in BOT_TOKEN, CLIENT_ID, GUILD_ID

# 4. Register slash commands
#    With GUILD_ID set → instant (use this during setup)
#    Without GUILD_ID  → global, up to 1 hour to propagate
npm run deploy

# 5. Start the bot
npm start
```

**Expected startup console output:**
```
  ✔  Loaded command: /setup
  ✔  Loaded command: /points
  ✔  Loaded command: /referrals
  ✔  Loaded command: /catalogue-members
  ✔  Loaded command: /backup-db
  ✔  Registered event: ready (once)
  ✔  Registered event: guildMemberAdd
  ✔  Registered event: guildMemberRemove
  ✔  Registered event: guildMemberUpdate
  ✔  Registered event: interactionCreate
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ | Your Discord bot token |
| `CLIENT_ID` | ✅ | Your application's client ID (for deploy-commands) |
| `GUILD_ID` | Optional | Guild ID for instant guild-scoped command registration |
| `DB_PATH` | Optional | Override the SQLite file path (default: `./data/referralbuddy.db`) |

---

## Bot Configuration (`/setup`)

All `/setup` subcommands require **Administrator** permission.

### First-time setup order

```
1. /setup set-log-channel      — where the bot posts logs
2. /setup set-referral-channel — where the panel and links are posted
3. /setup post-panel           — posts the "Get My Referral Link" button embed
4. /setup add-role-reward      — (optional) configure role-based point rewards
```

### `/setup set-log-channel channel:#channel`
Sets the channel where all bot log messages are posted. If not configured, the bot logs to console only.

### `/setup set-referral-channel channel:#channel`
Sets the channel where the referral panel is posted and where new invite links are announced.

### `/setup post-panel`
Posts the referral panel embed with the "Get My Referral Link" button into the configured referral channel. Re-run this if the panel message was deleted.

### `/setup add-role-reward role:@Role points:<integer>`
Configures a role so that when a referred member receives it, their referrer earns the specified points. Designed to integrate with levelling bots (MEE6, Arcane, Lurkr, etc.).

```
/setup add-role-reward role:@Level 1  points:10
/setup add-role-reward role:@Level 10 points:100
```

### `/setup remove-role-reward role:@Role`
Removes a role from the reward configuration. Existing awarded points are not affected.

### `/setup list-role-rewards`
Lists all currently configured role rewards.

---

## Commands Reference

### `/points check user:@User`
*Administrator only*

Displays a user's current point total and who referred them.

```
@FriendB has 42 referral point(s).
Referred by: @MemberA (MemberA#0001)
```

---

### `/points leaderboard`
*Administrator only*

Posts a top-10 leaderboard embed sorted by points descending.

---

### `/points adjust user:@User amount:<integer>`
*Administrator only*

Adds or subtracts points from a user. Points floor at 0 — they cannot go negative.

```
/points adjust user:@MemberA amount:50    → adds 50
/points adjust user:@MemberA amount:-25   → subtracts 25
```

Logged to the log channel with the admin's ID, the adjustment, and the new total.

---

### `/referrals check user:@User`
*Administrator only*

Shows how many invite codes the user has created and how many members they have successfully referred. Lists referred members by username if any exist.

---

### `/referrals set-referrer user:@User referrer:@Referrer`
*Administrator only*

Manually overrides the `referrer_id` on a member's record. Used for dispute resolution or to correct attribution errors. Self-referral (`@User === @Referrer`) is blocked.

Logged to the log channel.

---

### `/catalogue-members`
*Administrator only*

Manually re-runs the startup member catalogue for the current guild. Safe to run at any time — never overwrites existing `joined`, `has_left`, or `referrer_id` values.

Responds ephemerally with a count of newly catalogued vs. already-existing members.

---

### `/backup-db`
*Administrator only*

Triggers an immediate database backup to the `/backups` directory. Responds with the filename and timestamp. The 10-backup retention policy applies.

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

# Create named volume for data persistence
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

# Stop / remove
podman stop referralbuddy
podman rm referralbuddy
```

> The `:Z` volume flag sets the correct SELinux label on Fedora/RHEL hosts.

**Auto-start on login (user-level systemd):**

```bash
# Generate a systemd service from the running container
podman generate systemd --name referralbuddy --files --new
mkdir -p ~/.config/systemd/user
mv container-referralbuddy.service ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now container-referralbuddy
systemctl --user status container-referralbuddy

# Follow logs
journalctl --user -u container-referralbuddy -f
```

---

### Option 5: Podman Quadlet (systemd-native)

Quadlet is the modern Podman-native approach — no separate service file needed. Requires **Podman ≥ 4.4** (Fedora 38+, RHEL 9.2+).

```bash
# Build the image
podman build -t localhost/referralbuddy:latest .

# Prepare config and data directories
mkdir -p ~/.config/referralbuddy
cp .env ~/.config/referralbuddy/referralbuddy.env

# Edit the env file — ensure BOT_TOKEN, CLIENT_ID, GUILD_ID are set
nano ~/.config/referralbuddy/referralbuddy.env
```

Create the Quadlet container unit at `~/.config/containers/systemd/referralbuddy.container`:

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
# Create data directories
mkdir -p ~/.local/share/referralbuddy/data
mkdir -p ~/.local/share/referralbuddy/backups

# Enable and start
systemctl --user daemon-reload
systemctl --user enable --now referralbuddy

# Status and logs
systemctl --user status referralbuddy
journalctl --user -u referralbuddy -f
```

**System-wide (root) Quadlet:**

```bash
# Place unit in the system path
sudo cp referralbuddy.container /etc/containers/systemd/

# Edit the unit — replace %h with absolute paths, e.g. /opt/referralbuddy
sudo nano /etc/containers/systemd/referralbuddy.container

sudo systemctl daemon-reload
sudo systemctl enable --now referralbuddy
sudo journalctl -u referralbuddy -f
```

---

### Option 6: Systemd Service (no containers)

For servers where you want Node.js directly managed by systemd.

```bash
# Create a dedicated system user
sudo useradd -r -m -d /opt/referralbuddy -s /bin/false referralbuddy

# Copy project
sudo cp -r . /opt/referralbuddy/
sudo chown -R referralbuddy:referralbuddy /opt/referralbuddy

# Install dependencies as the service user
sudo -u referralbuddy bash -c "cd /opt/referralbuddy && npm ci --omit=dev"

# Place your .env
sudo cp .env /opt/referralbuddy/.env
sudo chmod 600 /opt/referralbuddy/.env
sudo chown referralbuddy:referralbuddy /opt/referralbuddy/.env
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
| `referral_points` | `user_id` | Running point total per user |
| `guild_members` | `user_id` | Join/leave status and referrer for every tracked member |
| `left_members` | `user_id` | Departure log with timestamp |
| `role_point_rewards` | `role_id` | Roles that trigger point awards to referrers |
| `role_reward_log` | `(user_id, role_id)` | Idempotency guard — prevents awarding the same role reward twice |
| `referral_button_cooldowns` | `user_id` | Tracks last button press time for rate limiting |
| `db_backup_log` | `rowid` | Record of every backup created (used for pruning) |

### Key design decisions

- **`guild_members.joined` is never reset to 0 on leave.** This is the leave-rejoin fraud guard — once a referrer is credited for a member joining, that credit is permanent.
- **`role_reward_log` is a composite-key table.** One row per `(user, role)` pair. Inserting a duplicate silently no-ops (`INSERT OR IGNORE`). This makes role reward attribution fully idempotent even if Discord fires `guildMemberUpdate` multiple times.
- **`referral_points` floors at 0.** The `addPoints` and `setPoints` functions use `MAX(0, ...)` — points can never go negative.
- **`getReferrer` is the only referrer lookup.** No event or command queries `guild_members.referrer_id` directly. This means if referrer resolution logic ever needs to change, it changes in one place.

---

## Troubleshooting

**Joins show as ambiguous — "Could not determine invite code"**
- The bot was offline when the member joined, so the invite cache was stale.
- Two members joined simultaneously on different invites — the diff is ambiguous.
- Use `/referrals set-referrer` to manually attribute the join.

**No points awarded after a valid join**
- Check that `Server Members Intent` is enabled in the Developer Portal under Privileged Gateway Intents.
- Confirm the invite code appears in the `invite_codes` table with the correct `created_by_id`.
- If `guild_members.joined` is already `1` for the joining member, they are a rejoin and no points are awarded by design.

**Role rewards not firing**
- Run `/setup list-role-rewards` to confirm the role is configured.
- Ensure `Server Members Intent` is enabled — it is required for `guildMemberUpdate`.
- Check the log channel for a "no referrer on record" message, which means `getReferrer()` returned `null` for that member. Use `/referrals set-referrer` to fix the record.

**"Get My Referral Link" button gives a cooldown error immediately**
- The member pressed the button within the last hour. The reply shows the exact remaining wait time.

**Slash commands don't appear in Discord**
- Run `npm run deploy` to register them.
- With `GUILD_ID`: instant. Without `GUILD_ID` (global): up to 1 hour.

**Database errors on startup**
- Only one bot process should access the database at a time.
- Ensure the `data/` and `backups/` directories are writable by the process user.
- If the database is corrupted, restore from the latest file in `backups/`.

**Backups fail**
- `better-sqlite3`'s `.backup()` method performs a safe online backup — the database does not need to be offline.
- Ensure the `backups/` directory exists and is writable.

---

## Security Notes

- **Never commit `.env`** — it is in `.gitignore`. Use environment secrets in your CI/CD system.
- The Podman and Docker setups run as a **non-root user** inside the container.
- The Quadlet unit can be hardened with `NoNewPrivileges=true` and `ReadOnlyRootfs=true`.
- The systemd unit uses `NoNewPrivileges`, `PrivateTmp`, and `ProtectSystem=strict`.
- All admin commands (`/points`, `/referrals`, `/catalogue-members`, `/backup-db`, `/setup`) require the **Administrator** Discord permission. Do not grant the bot itself Administrator — see the exact permission list in the portal setup section.
- The bot **never assigns Discord roles**. It only reads role events. This limits blast radius if the bot token is ever compromised.
