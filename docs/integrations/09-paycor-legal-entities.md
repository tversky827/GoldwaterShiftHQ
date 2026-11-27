# Paycor legal entities → facilities (Goldwater)

Provided by the owner on 2026-11-27. Each legal entity (LLC) belongs to one facility.
The AOD name is the first part of the AOD work group (see `aodFacilityFromWorkgroup`).

| Paycor legal entity | ID | Facility (AOD name) | In ShiftHQ? |
|---|---|---|---|
| Goldwater Care Bloomington LLC | 164922 | Bloomington | Yes |
| Goldwater Care Clinton LLC | 186852 | Clinton | Yes |
| Goldwater Care Danville LLC | 164962 | Danville | Yes |
| Goldwater Care Gibson City | 164961 | Gibson City | Yes |
| Goldwater Care Marseilles LLC | 176091 | Marseilles | Yes |
| Goldwater Care Peoria Heights LLC | 181956 | Peoria Heights | Yes |
| Goldwater Care Princeton LLC | 176092 | Princeton | Yes |
| Goldwater Care Roseville LLC | 181957 | Roseville | Yes |
| Goldwater Care Spring Valley LLC | 176115 | Spring Valley | Yes |
| Goldwater Care Toluca LLC | 176093 | Toluca | Yes |
| Goldwater Pontiac Nursing Home LLC | 153619 | Pontiac | Yes |
| Goldwater Estates of Clinton LLC | 186860 | Estates of Clinton | **No** (owner: not scheduled in ShiftHQ) |

## How it's used
- Paycor activation is per legal entity: activate the 11 above, **not** Estates of Clinton (186860).
- Settings → Integrations → Mappings → "Map a Paycor legal entity": enter each ID and pick its facility.
  Employees are placed by Paycor work location first (exact facility name or a saved location mapping),
  then by legal entity. Legal entities that still don't map are listed under "Needs mapping".
- AOD: `AOD_IGNORE_FACILITIES=Estates of Clinton` (set in the cloud environment).
- Facility names in ShiftHQ should match the AOD names above (e.g. "Bloomington") so AOD punches map
  without extra mappings; a longer display name needs an AOD location mapping instead.
