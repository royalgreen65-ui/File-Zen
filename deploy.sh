#!/bin/sh
echo "Building project..."
npm run build
if [ $? -ne 0 ]; then exit 1; fi

echo "Adding dist folder..."
git add dist -f
if [ $? -ne 0 ]; then exit 1; fi

echo "Committing build..."
git commit -m "Deploy to GitHub Pages"

echo "Pushing to gh-pages..."
git subtree push --prefix dist origin gh-pages
