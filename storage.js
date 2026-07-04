/**
 * storage.js — Only save/load.
 * Every other module reads/writes app data through this file so the
 * persistence strategy (currently localStorage) can change later
 * without touching the rest of the codebase.
 */
const Storage = (() => {
  const NS = "cricketai:";

  function key(name) {
    return NS + name;
  }

  function get(name, fallback = null) {
    try {
      const raw = localStorage.getItem(key(name));
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn("[storage] read failed for", name, err);
      return fallback;
    }
  }

  function set(name, value) {
    try {
      localStorage.setItem(key(name), JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn("[storage] write failed for", name, err);
      return false;
    }
  }

  function remove(name) {
    localStorage.removeItem(key(name));
  }

  function listMatchIds() {
    return get("matchIndex", []);
  }

  function saveMatch(match) {
    const idx = listMatchIds();
    if (!idx.includes(match.id)) {
      idx.unshift(match.id);
      set("matchIndex", idx);
    }
    set(`match:${match.id}`, match);
  }

  function loadMatch(id) {
    return get(`match:${id}`, null);
  }

  function deleteMatch(id) {
    remove(`match:${id}`);
    set("matchIndex", listMatchIds().filter((x) => x !== id));
  }

  function setActiveMatchId(id) {
    set("activeMatchId", id);
  }

  function getActiveMatchId() {
    return get("activeMatchId", null);
  }

  return {
    get,
    set,
    remove,
    listMatchIds,
    saveMatch,
    loadMatch,
    deleteMatch,
    setActiveMatchId,
    getActiveMatchId,
  };
})();
