(function () {
  if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
    window.__adobe_cep__.evalScript(
      'try { app.preferences.savePrefAsLong("Main Pref Section v2", "Pref_SCRIPTING_FILE_NETWORK_SECURITY", 1); app.preferences.savePrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY", 1); app.preferences.saveToDisk(); } catch(_e) {}'
    );
  }
})();
