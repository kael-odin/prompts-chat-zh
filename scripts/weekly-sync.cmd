@echo off
rem ============================================================
rem  Weekly local sync + translate + push for prompts-chat-zh.
rem
rem  Why local: the relay endpoint blocks datacenter IPs, so
rem  GitHub Actions runners always get "fetch failed" on the
rem  translate step. This machine can reach it directly.
rem
rem  Flow: pull upstream -> translate new/changed items
rem        (cache is content-hash keyed, so only the delta costs)
rem        -> commit cache -> push. The push triggers deploy.yml
rem        on GitHub which rebuilds and deploys the site.
rem
rem  Requires: TRANSLATE_API_KEY filled in .env at repo root.
rem  Log: %TEMP%\prompts-chat-zh-sync.log
rem ============================================================
setlocal
set LOG=%TEMP%\prompts-chat-zh-sync.log
echo ===== %DATE% %TIME% ===== >> "%LOG%"
cd /d D:\Github-Star\prompts-chat-zh >> "%LOG%" 2>&1
if errorlevel 1 (echo [ERR] repo dir not found >> "%LOG%" & exit /b 1)

rem 1. Pull upstream snapshot
echo [1/3] sync upstream >> "%LOG%"
call npm run sync >> "%LOG%" 2>&1
if errorlevel 1 (echo [ERR] sync failed >> "%LOG%" & exit /b 1)

rem 2. Translate delta (incremental, checkpointed every 25 items)
echo [2/3] translate delta >> "%LOG%"
call npm run translate -- --concurrency=6 >> "%LOG%" 2>&1
if errorlevel 1 (echo [ERR] translate failed, nothing committed >> "%LOG%" & exit /b 1)

rem 3. Commit and push cache; the push triggers deploy.yml
echo [3/3] commit and push >> "%LOG%"
git add data/upstream.json data/zh.json >> "%LOG%" 2>&1
git diff --staged --quiet >> "%LOG%" 2>&1
if %errorlevel%==0 (
  echo [OK] nothing new, cache unchanged >> "%LOG%"
  exit /b 0
)
git commit -m "chore: sync translation cache from local runner" >> "%LOG%" 2>&1
if errorlevel 1 (echo [ERR] commit failed >> "%LOG%" & exit /b 1)
git push origin main >> "%LOG%" 2>&1
if errorlevel 1 (echo [ERR] push failed >> "%LOG%" & exit /b 1)

echo [OK] done, deploy.yml will rebuild the site >> "%LOG%"
endlocal
