# Weekly refresh (v2.0)

The refresh runs as a GitHub Actions workflow (`.github/workflows/refresh.yml`) on Sundays at 07:00 Doha time. MoJ posts the previous week's bulletin on Wednesday or Thursday, so Sunday is safe.

**On success:** the workflow commits `data/` plus any newly discovered MoJ URLs, with a summary taken from `data/changes.json`, and then redeploys Pages.

**On failure:** nothing is committed and GitHub emails the owner. Common causes:
- **UNMAPPED districts:** a new MoJ district name appeared. Add it to `data/district_aliases.json`, mapping it to an existing area id or a new area added to `data/areas.json`.
- **"keeping previous file":** Property Finder or OpenStreetMap blocked or changed. The previous data stays in place.
- **"only N records":** a source was unreachable from GitHub's servers. Run `python -I tools/refresh.py` locally to compare.

`data/areas.json` and `data/rules.json` are never changed automatically. Check the freehold list and residency thresholds by hand every few months.

**v2 additions:** after Property Finder, the refresh re-applies `data/project_overrides.csv`, saves a weekly snapshot to `data/history/`, logs stock, handover and status changes, and writes the email digest. If `MAIL_TO` is set, the workflow emails `data/digest.html`. Fill `data/taameer_projects.csv` from the internal price list, and update it whenever prices change.
