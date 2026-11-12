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
//          skins chat beCounter
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
        36510, // Sedat Ozbasi
        39213, // Ali Al- Turaim
        32651, // Egehan Akali
        22610, // Jari Bezemer
        42368, // Sharlton Matwirjo
        35714 // Jokke Jacobs
      ]
    },
    {
      "name": "shiftlead",
      "allow": ["settings", "comboBatcher", "replenish", "batchOpt", "zap", "dayson", "unpick", "pickStats", "colors", "skins", "beCounter"],
      "users": [
        18089 // Rodney Huijgen
      ]
    },
    {
      "name": "megamulters",
      "allow": ["settings", "comboBatcher", "comboAlert", "batchOpt", "leaderboard", "autoNext", "cardColor", "colors", "pickAll", "truePickAll", "bulkSingles", "skins"],
      "users": [
      ]
    }
  ],
  "leftovers": { "allow": ["comboAlert", "leaderboard", "bulkSingles", "skins"] }
};
