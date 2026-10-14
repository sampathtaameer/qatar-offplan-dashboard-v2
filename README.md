# Qatar Off-Plan Dashboard v2.0 (internal)

Internal Taameer dashboard for Qatar's off-plan market. Static site, English and Arabic, no build step. Leaflet, Chart.js, SunCalc and SheetJS load from cdnjs. An **Analyst** toggle shows every formula and source.

v1 is still in the sibling folder `Qatar Off-Plan Dashboard` and is unchanged.

## What's new in v2.0

| Area | Change |
|---|---|
| Coverage | Besides the ~44 projects in Property Finder's **New Projects** section (developers pay to appear there), v2.0 reads **every for-sale page** (about 460 residential + 15 commercial) and keeps listings tagged off-plan. `tools/build_broker_projects.py` groups them by building. Buildings that match a developer project add a "broker listings" panel to it; the rest become projects labelled **Broker listings**. First scan (14 Oct 2026): 3,226 off-plan listings, 24 matches, 138 new projects. |
| Supply | `data/project_overrides.csv` adds researched unit counts, floors, handover dates and locations. Each override cites its source. The refresh re-applies it every week. |
| Locations | Every project has a **location quality**: building, district or generic. 10 of the 12 generic pins were moved to the correct district; 2 remain generic (The 44 Tower, Thirty Five). |
| Delivered projects | Completed projects are under **Projects → Recently delivered** and are left out of the pipeline figures. |
| Like-for-like pricing | Each unit is compared with Ministry of Justice sales in the same area **and size band** (25–75, 75–110, 110–160, 160–250, 250+ sqm). The project premium is the median across its units. |
| Net yield | Net yield sits next to gross yield (service charge, vacancy, purchase costs) and is flagged when the rent sample has fewer than 15 listings. |
| History | `tools/snapshot.py` keeps a weekly copy of every project (`data/history/`). These copies feed the price-change, handover-delay and watchlist views. Tracking started on 11 Oct 2026. |
| Payment plans | Published plans are parsed into percentages. The project page shows a monthly cash flow, the value of the payments today, investor IRR, equity multiple and peak cash. |
| New pages | **Lusail & Qetaifan** deep dive, **Developers** scorecard, **Taameer** positioning. Watchlist stars stay; **⚙ → Copy watchlist** moves them to the email list. |
| Areas | **87 areas cover every Ministry of Justice district** (`tools/district_map.py`; small districts fall into an "other districts" area per municipality). The Areas page has a map and five table views: summary, sales & prices (apartments, villas, land), off-plan, rent & yield, location. Rents come from every rental listing on Property Finder (33,570 on 14 Oct 2026). Where no apartments trade, the yield is a villa yield and the area page charts villa and land prices per sqm of plot. |
| Overview | Market pulse for apartments in freehold and usufruct areas, with month-on-month and year-on-year change, a median-price trend, supply by handover year, and a map of projects coloured by premium. |
| Usability | Excel export on every table page, a ⚙ assumptions panel, watchlist stars, on-page messages instead of browser pop-ups, and Compare that uses each project's own facade and floor. |
| Look | Taameer house colours, Segoe UI, light theme by default, and a print stylesheet. |
| Hosting | Private repository. The weekly email digest is optional. GitHub Pages is off by default. |

## Run it locally

```bash
python -I tools/serve.py
```

Then open http://127.0.0.1:8766. It uses port 8766, so v1 can still run on 8765, and browser settings are kept separately (`v2.` prefix). Opening `index.html` directly from disk won't work.

## Files you edit by hand

| File | What it holds |
|---|---|
| `data/taameer_projects.csv` | **Taameer's own projects**, one row per unit type: size, price, payment-plan percentages. It is pre-filled with Property Finder starting prices for La Mer Tower, Seef Waterfront, Canal Bay and Carlton House, and with broker median asking prices (first sale) for Flora, Valencia, Skala Tower and Taameer Central Tower (offices). **Replace these with the internal price list.** The `project` column links a row to the public listing id where one exists. |
| `data/project_overrides.csv` | Corrections to listings: `units_total`, `floors`, `handover`, `status`, `area_id`, `lat`/`lng`, plus `source`, `source_url` and `note`. Leave a cell empty to keep the listing value. Run `python -I tools/apply_overrides.py` after editing. |
| `data/developers.csv` | Delivery record for past projects (on time, late, average delay, notes). Delays on current projects are detected automatically from the weekly snapshots. |
| `data/assumptions.json` | Default assumptions for net yield and cash flow. Anyone can change them in their own browser with ⚙. |
| `data/watchlist.json` | Project ids included in the weekly email. Stars clicked in the dashboard are saved in that browser only; use **⚙ → Copy watchlist** to move them here. |
| `data/areas.json`, `data/rules.json`, `data/district_aliases.json`, `data/pipeline.json` | As in v1. `district_aliases.json` is checked before the built-in table in `tools/district_map.py`. |
| `data/pf_area_map.json` | Property Finder location → area, for rents. The refresh prints any rental location it can't place. |

After any edit, run `python -I tools/validate.py`.

## Refresh the data

```bash
python -I tools/refresh.py            # add --full monthly, --no-pf to skip Property Finder
```

The steps run in this order: Ministry of Justice bulletins → deals and transactions → Property Finder (New Projects, the full rental scan, about 35 minutes, and the full off-plan listing scan, about 20 minutes) → broker projects → override sheet → weekly snapshot → "What changed" (now also stock, handover moves and status) → validation → email digest (`data/digest.html` and `data/digest_subject.txt`). The command exits with 1 if validation fails; in that case, don't commit.

Raw MoJ CSVs are in `data/raw/`. Missing ones are downloaded again from the URL lists in `tools/`.

## Set up the private repository (one time)

1. On GitHub, create a **private** repository, for example `qatar-offplan-dashboard-v2`. Don't reuse the public v1 repository.
2. Upload this folder. Either use git, or use **Add file → Upload files** (`tools/bridge.html` with `tools/serve.py` copies the project to the clipboard). The workflow file is in **`setup/refresh.yml`**: in the repository choose **Add file → Create new file**, name it `.github/workflows/refresh.yml`, and paste the contents in. If you use git, copy it to `.github/workflows/refresh.yml` before committing.
3. Under **Settings → Actions → General → Workflow permissions**, choose **Read and write**.
4. **Email digest (optional).** Under **Settings → Secrets and variables → Actions → Secrets**, add:
   - `MAIL_SERVER` (for example `smtp.office365.com`), `MAIL_PORT` (`587`)
   - `MAIL_USERNAME` and `MAIL_PASSWORD`: a mailbox that is allowed to send by SMTP. IT may need to enable SMTP AUTH or give you an app password.
   - `MAIL_TO`: recipients, separated by commas.
   If `MAIL_TO` is not set, the email step is skipped.
5. **GitHub Pages (optional, not recommended for internal data).** A Pages site is publicly reachable even from a private repository, unless the organisation uses GitHub Enterprise Cloud with private Pages. To turn it on anyway, add the repository **variable** `DEPLOY_PAGES` = `true` and set **Settings → Pages → Source: GitHub Actions**.
6. To test it, go to **Actions → "Refresh data, email digest, deploy" → Run workflow**.

To view the refreshed data locally, pull the repository (or download it as a ZIP) and run `serve.py`.

## Broker-listing projects

- **Source:** `data/raw/pf_offplan_listings.json` holds one row per off-plan sale listing, from `fetch_propertyfinder.py --offplan`. If a weekly scan returns fewer than half the previous count (blocked or site changed), the previous file is kept.
- **Pricing:** only listings marked **off-plan, first sale** are priced (median asking price and QAR/sqm per unit type). Listings with no sale type are counted but not priced. Resales and land are excluded. Listings with implausible prices (for example under QAR 150,000, or outside QAR 3,000–60,000/sqm for homes) are dropped.
- **What the listings don't give:** the developer, handover date and unit count. Add these in `data/project_overrides.csv` (columns `developer` and `name_en` can be set too). Use the project id shown in the page address, for example `pf-lusail-residence-1532`.
- **Watch for mis-tagged buildings:** brokers sometimes tag completed towers as off-plan (for example Viva East and West at The Pearl). These have low confidence. To remove one from the pipeline, set `status` to `completed` in the override sheet.
- **Areas outside the original list:** ten areas were added to `data/areas.json` (for example Al Kheesa, Umm Salal, Izghawa, Muaither). They are not designated for non-Qatari ownership.

## Developer data (no manual input needed)

- **Listing descriptions:** `fetch_propertyfinder.py --details` reads each off-plan listing's description; after the first run only new listings are read. `tools/listing_facts.py` extracts the developer, handover, floors, units and payment terms.
- **Agreement rule:** a value is used only when **3 different brokers** state it, or a listing marked direct-from-developer does. Everything else is shown on the project page as "needs review" and never filled in. Filled values only replace empty fields; developer-listed projects keep Property Finder's own developer.
- **Mis-filed listings:** a listing whose description names a different known project is counted under that project. The first run moved 134 listings.
- **Developer names:** `data/developer_aliases.json` lists Qatar developers and how listings spell them. A developer named in the building's own name ("Burj DAMAC …", "Al Asmakh …") is used directly.
- **Research:** `data/developer_research.csv` holds developers, handovers and statuses found in press and on removed Property Finder project pages, each with a link and a confidence level. It sits below your `project_overrides.csv`, so your corrections always win.
- **Review list:** `data/review.json` (the same items show as "needs review" on each project page) flags handover dates where brokers disagree with the published date, developers named by too few brokers, and buildings with no first-sale listings.

## Methods (also shown in Analyst mode)

- **Like-for-like premium.** Unit QAR/sqm (starting price ÷ size) is compared with the median of MoJ residential-unit sales in the same area and size band over the last 12 months. If a band has fewer than 8 sales, all sizes are used (marked \*). Qetaifan and Gewan borrow Lusail and The Pearl. Villas and townhouses are excluded, because MoJ villa records give plot area. MoJ sales are mostly completed units, so the premium is what buyers pay for new stock with a payment plan.
- **Net yield.** (Median asking rent × 12 × (1 − vacancy) − service charge × size × 12) ÷ (price × (1 + purchase costs)).
- **Payment plan.** Down payment now. Construction instalments are paid monthly over the stated years, or until handover. The handover payment falls in the handover month. Post-handover instalments are paid monthly over the stated years (3 years if not stated). Where the published shares add up to less than 100%, the rest is assumed to be paid in instalments over the stated years, and the plan is flagged.
- **Investor IRR.** Purchase costs are paid up front. Net rent starts at handover. The unit is sold after the hold period at price × (1 + growth)^years, less selling costs. Any unpaid instalments are settled at the sale.
- **Market pulse.** Apartment sales in freehold and usufruct areas, complete months only. The median price is taken over the last 3 complete months and compared with the same 3 months a year earlier.
- **Sun, noise, livability.** As in v1. The results are only as good as the project's location quality.

## Known gaps

- Broker-listing projects carry asking prices, not developer price lists, and are grouped by Property Finder's building names. Check new ones before relying on them.
- 28 of 33 developer-listed pipeline projects still don't publish unit counts, so pipeline supply is understated. Add counts to the override sheet as you learn them.
- Prices are Property Finder **starting** prices, not full price lists.
- The delivery record and price history build up week by week from 11 Oct 2026.
