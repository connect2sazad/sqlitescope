#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -d node_modules/electron ]; then
  echo "Installing SQLiteScope dependencies..."
  npm install
fi
npm start
