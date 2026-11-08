// =====================================================================
//  PICQER SUITE · TEAMS (who may use what)
//  Edit here on GitHub and commit. Every PC has it within ~10 min.
//  Easiest: Shift+8 -> Teams -> Copy config -> paste over this whole file.
//
//  users : Picqer user ids, or a full name in "quotes" (developers Picqer)
//          someone in 2 teams -> the first team counts
//  allow : "*" = everything, or a list of:
//          settings comboBatcher comboAlert replenish shipErr addrFix
//          banner batchOpt zap dayson unpick pickStats autoNext cardColor
//          colors pickAll bulkSingles
//  leftovers: everyone who is in no team
// =====================================================================
window.PQ_TEAMS = {
  "teams": [
    {
      "name": "shiftlead",
      "allow": "*",
      "users": [
        32247, // Ahmad Saber
        "Ahmad Saber"
      ]
    },
    {
      "name": "troubleshoot",
      "allow": ["comboAlert", "replenish", "shipErr", "addrFix", "banner", "batchOpt", "zap", "dayson", "unpick", "autoNext", "cardColor", "pickAll", "bulkSingles"],
      "users": [
         39213, // Ahmad Saber
        "Ali Al- Turaim"
      ]
    },
    {
      "name": "megamulters",
      "allow": ["comboBatcher", "comboAlert", "replenish", "banner", "batchOpt", "autoNext", "cardColor", "pickAll", "bulkSingles"],
      "users": [
         39213, // Ahmad Saber
        "Ali Al- Turaim"
      ]
    }
  ],
  "leftovers": { "allow": ["comboAlert", "shipErr", "banner", "autoNext", "cardColor", "pickAll", "bulkSingles"] }
};
