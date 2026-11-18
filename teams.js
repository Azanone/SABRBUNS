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
        "Ahmad Saber",
        22610, // Jari Bezemer
        37129, // Steyn Rombout
        39213 // Ali Al- Turaim
      ]
    },
    {
      "name": "a",
      "allow": ["settings", "comboAlert", "autoNext", "pickAll", "truePickAll", "bulkSingles"],
      "users": [
        32602, // Emir Seme
        42368, // Sharlton Matwirjo
        28469, // Dani Scheers
        34369 // Efe Yildrim
      ]
    },
    {
      "name": "shiftlead",
      "allow": ["settings", "comboBatcher", "comboAlert", "replenish", "batchOpt", "zap", "dayson", "unpick", "leaderboard", "autoNext", "pickAll", "bulkSingles", "beCounter", "shiftTools"],
      "users": [
        35714, // Jokke Jacobs
        18089, // Rodney Huijgen
        23384 // Joshua van der Meer
      ]
    }
  ],
  "leftovers": { "allow": ["bulkSingles"] }
};
