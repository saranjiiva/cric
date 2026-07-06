/**
 * players.js — Only player management.
 */
const Players = (() => {
  let counter = 0;

  function makeId() {
    counter += 1;
    return `p${Date.now().toString(36)}${counter}`;
  }

  function add(team, name, role = "bat") {
    const player = {
      id: makeId(),
      name: name.trim(),
      role, // 'bat' | 'bowl' | 'all' | 'wk'
      stats: {
        runs: 0,
        ballsFaced: 0,
        fours: 0,
        sixes: 0,
        out: false,
        oversBowled: 0,
        runsConceded: 0,
        wickets: 0,
      },
    };
    team.players.push(player);
    return player;
  }

  function remove(team, playerId) {
    team.players = team.players.filter((p) => p.id !== playerId);
  }

  function find(team, playerId) {
    return team.players.find((p) => p.id === playerId) || null;
  }

  function applyBallToBatter(player, ball) {
    if (!player) return;
    if (!ball.wide) player.stats.ballsFaced += 1;
    if (!ball.wide && !ball.bye && !ball.legbye) {
      player.stats.runs += ball.runs;
      if (ball.runs === 4) player.stats.fours += 1;
      if (ball.runs === 6) player.stats.sixes += 1;
    }
    if (ball.wicket && ball.wicketBatterId === player.id) {
      player.stats.out = true;
    }
  }

  function applyBallToBowler(player, ball) {
    if (!player) return;
    const runsAgainst =
      ball.runs + (ball.wide ? 1 : 0) + (ball.noball ? 1 : 0);
    player.stats.runsConceded += runsAgainst;
    if (ball.wicket && ball.wicketMode !== "runOut") {
      player.stats.wickets += 1;
    }
  }

  return { add, remove, find, applyBallToBatter, applyBallToBowler };
})();
