# Session Notes

## Ports 8000 / 3000 already in use
- Found stale processes: python (PID 17564) on 8000, node (PID 14488) on 3000. Killed both.
- To do it manually (PowerShell):
  - `Get-NetTCPConnection -LocalPort 8000 -State Listen | Select OwningProcess`
  - `Stop-Process -Id <PID> -Force`

## Servers restarted
- Next.js: `npm run dev` (http://localhost:3000)
- API: `.venv/Scripts/python.exe -m uvicorn backend.api:app --port 8000`

## Favicon
- Could not reproduce an error on :3000. `/favicon.ico` returns 200 and `src/app/favicon.ico` is a valid ICO.
- `/favicon.ico` returns 404 on :8000 (FastAPI has no such route). This is harmless and only shows if :8000 is opened directly in a browser.
- Try a hard refresh (Ctrl+Shift+R) to clear any stale cache. Optionally add a `/favicon.ico` route (204) to `backend/api.py`.

## Pin drag glitch (start/end pins showed the previous route)
- Cause: route GeoJSON layers were keyed on the new pin positions but still rendered the old fetched data until the new response arrived.
- Fix in `src/components/CampusMap.tsx`: fetched data is tagged with the request key, and routes only draw when the tag matches the current inputs. Stale routes are hidden while loading.
- `tsc --noEmit` passes. Not yet verified in a browser.
- Known nit: the JSX wrapped around the route layers is not indented to match the file (run Prettier).
