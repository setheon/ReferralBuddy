'use strict';

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;

/**
 * Returns true if the member holds the configured admin role.
 * Falls back to Administrator permission if ADMIN_ROLE_ID is not set.
 */
function isAuthorized(member) {
  if (!member) return false;
  if (ADMIN_ROLE_ID) return member.roles.cache.has(ADMIN_ROLE_ID);
  return member.permissions.has('Administrator');
}

/**
 * Replies ephemerally with a permission error and returns false.
 * Use as an early-return guard at the top of every command execute().
 */
async function denyUnauthorized(interaction) {
  await interaction.reply({
    content: '❌ You do not have permission to use this command.',
    flags: 1 << 6,
  });
  return false;
}

module.exports = { isAuthorized, denyUnauthorized };
