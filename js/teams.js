/**
 * teams.js — Only team management.
 */
const Teams = (() => {
  function create(nameA, nameB) {
    return {
      A: { id: "A", name: nameA || "Team A", players: [] },
      B: { id: "B", name: nameB || "Team B", players: [] },
    };
  }

  function rename(teams, side, name) {
    if (teams[side]) teams[side].name = name;
    return teams;
  }

  function other(side) {
    return side === "A" ? "B" : "A";
  }

  return { create, rename, other };
})();
