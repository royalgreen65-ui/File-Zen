@echo off
echo Building project...
call npm run build
if %errorlevel% neq 0 exit /b %errorlevel%

echo Adding dist folder...
git add dist -f
if %errorlevel% neq 0 exit /b %errorlevel%

echo Committing build...
git commit -m "Deploy to GitHub Pages"
if %errorlevel% neq 0 (
  echo Commit failed, possibly nothing to commit. Continuing...
)

echo Pushing to gh-pages...
git subtree push --prefix dist origin gh-pages
if %errorlevel% neq 0 (
  echo Push failed. Trying force push method...
  git push origin `git subtree split --prefix dist main`:gh-pages --force
)

echo Deployment complete!
