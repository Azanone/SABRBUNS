// =====================================================================
//  PICQER SUITE · TEAMS (who may use what)
//  Edit here on GitHub and commit. Every PC has it within ~10 min.
//  Easiest: Shift+8 -> Teams -> Copy config -> paste over this whole file.
//
//  users : Picqer user ids, or a full name in "quotes" (developers Picqer)
//          someone in 2 teams -> the first team counts
//  allow : "*" = everything, or a list of:
//          settings comboBatcher comboAlert replenish shipErr addrFix
//          banner batchOpt zap dayson unpick pickStats leaderboard
//          autoNext cardColor colors pickAll truePickAll bulkSingles
//          skins chat beCounter shiftTools
//  leftovers: everyone who is in no team
// =====================================================================
window.PQ_TEAMS = {
  "teams": [
    {
      "name": "Shift leaders",
      "allow": "*",
      "users": [
        32247, // Ahmad Saber
        "Ahmad Saber"
      ]
    },
    {
      "name": "a",
      "allow": ["settings", "comboAlert", "autoNext", "pickAll", "bulkSingles"],
      "users": [
        32602, // Emir Seme
        42368 // Sharlton Matwirjo
      ]
    }
  ],
  "leftovers": { "allow": ["bulkSingles"] }
};
