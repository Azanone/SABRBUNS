# Leaderboard middle stop

Asks Picqer once a minute for everyone, so 20 PCs don't each ask Picqer.
Returns user ids and numbers only, no names.

1. dash.cloudflare.com → Workers & Pages → Create → Worker → Deploy
2. Edit code → paste `worker.js` → Deploy
3. Settings → Variables and Secrets
   - `PICQER_KEY` (type Secret): Picqer API key
   - `PICQER_HOST`: `trl-fulfilment.picqer.com`
   - `WAREHOUSE`: `Bunsenstraat`
4. Open `https://<your-worker>.workers.dev/leaderboard` and you should see JSON
5. Put `https://<your-worker>.workers.dev` in the suite (Shift+8 → Leaderboard → Middle stop), or send it to be made the default for every PC
