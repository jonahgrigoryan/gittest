const fs = require("fs");
const path = require("path");

const sessionDir = "results/hands";

function checkInvariants() {
  try {
    if (!fs.existsSync("results") || !fs.existsSync(sessionDir)) {
        console.log("No hands directory found in results");
        return;
    }
  } catch (e) {
    console.log("Error checking directories");
    return;
  }

  const sessions = fs.readdirSync(sessionDir);
  let totalHands = 0;
  let issues = [];

  for (const session of sessions) {
    const sessionPath = path.join(sessionDir, session);
    try {
        if (!fs.statSync(sessionPath).isDirectory()) continue;
    } catch (e) { continue; }

    const files = fs.readdirSync(sessionPath).filter(f => f.endsWith(".jsonl"));
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(sessionPath, file), "utf-8");
      const lines = content.trim().split("\n");
      
      for (const line of lines) {
        if (!line) continue;
        try {
          const record = JSON.parse(line);
          totalHands++;
          const state = record.rawGameState;
          
          let players = state.players;
          let playerCount = 0;
          
          if (Array.isArray(players)) {
              playerCount = players.length;
          } else if (players && typeof players === "object") {
              playerCount = Object.keys(players).length;
          }

          if (playerCount < 2) {
             issues.push(`Hand ${state.handId}: Fewer than 2 players (${playerCount})`);
          }

          if (players && typeof players === "object" && !Array.isArray(players)) {
              for (const key in players) {
                  const player = players[key];
                  if (player && typeof player.stack === "number" && player.stack < 0) {
                      issues.push(`Hand ${state.handId}: Negative stack for ${key}`);
                  }
              }
          }

          const validStreets = ["preflop", "flop", "turn", "river"];
          if (!validStreets.includes(state.street)) {
            issues.push(`Hand ${state.handId}: Invalid street ${state.street}`);
          }

        } catch (e) {
          // Ignore
        }
      }
    }
  }

  console.log(`Checked ${totalHands} hands.`);
  if (issues.length > 0) {
    console.log("Issues found:");
    issues.forEach(i => console.log(i));
  } else {
    console.log("No invariant violations found.");
  }
}

checkInvariants();
