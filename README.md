# Calorie Track

A small self-hosted calorie and macro tracker. You log what you eat with
calories, protein, carbs and fat, and it adds them up into a daily total
measured against your goals.
Each day starts empty, and previous days stay browsable with the ‹ › arrows.

- Zero dependencies: plain Node (>= 18) and one static page
- Data lives in `data/db.json` (gitignored)
- Foods you've logged before autocomplete and fill in their macros
- Light/dark theme follows the device; prompts to install as a home-screen app

## Run locally

```bash
npm start            # http://127.0.0.1:4100
```

Env vars: `PORT` (default 4100), `HOST` (default 127.0.0.1), `DATA_FILE`
(default `./data/db.json`).

## Deploy (Raspberry Pi + Cloudflare Tunnel)

```bash
git clone https://github.com/ZayanMA/calorie-track.git ~/calorie-track
sudo cp ~/calorie-track/deploy/calorie-track.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now calorie-track
```

Add an ingress rule to `/etc/cloudflared/config.yml`, above the catch-all rule:

```yaml
  - hostname: calories.zayan.uk
    service: http://localhost:4100
```

Then create the DNS route and restart the tunnel:

```bash
cloudflared tunnel route dns <tunnel-name> calories.zayan.uk
sudo systemctl restart cloudflared
```

The app has no login of its own. Put the hostname behind a Cloudflare Access
application.

Update: `cd ~/calorie-track && git pull && sudo systemctl restart calorie-track`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/entries?date=YYYY-MM-DD` | entries for a day |
| POST | `/api/entries` | `{name, date, calories, protein, carbs, fat}` |
| PUT / DELETE | `/api/entries/:id` | edit / remove |
| GET / PUT | `/api/goals` | daily targets |
| GET | `/api/foods` | recently used foods |
