#!/usr/bin/env bash
# Install a location-independent launcher; never modify the signed host app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/Applications/Codex Navigator.app"
TEMP_DIR="$(mktemp -d -t codex-navigator-launcher)"
trap 'rm -f "$TEMP_DIR/launcher.applescript" "$TEMP_DIR/launcher.scpt"; rmdir "$TEMP_DIR" 2>/dev/null || true' EXIT
cat > "$TEMP_DIR/launcher.applescript" <<'APPLE'
-- Locate the resolver relative to this launcher app, not to a repository path.
set resourcesPath to (POSIX path of (path to me)) & "Contents/Resources/"
do shell script "nohup /bin/bash " & quoted form of (resourcesPath & "launcher-entry.sh") & " >/dev/null 2>&1 &"
APPLE
/usr/bin/osacompile -o "$TEMP_DIR/launcher.scpt" "$TEMP_DIR/launcher.applescript"
if [[ ! -f "$DEST/Contents/Resources/Scripts/main.scpt" ]]; then
  mkdir -p "${HOME}/Applications"
  /usr/bin/osacompile -o "$DEST" "$TEMP_DIR/launcher.applescript"
fi
cp "$DEST/Contents/Resources/Scripts/main.scpt" "$DEST/Contents/Resources/Scripts/main.previous.scpt"
cp "$ROOT/scripts/launcher-entry.sh" "$DEST/Contents/Resources/launcher-entry.sh"
cp "$ROOT/scripts/launcher-resolver.mjs" "$DEST/Contents/Resources/launcher-resolver.mjs"
node --input-type=module - "$ROOT" <<'JS'
import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {homedir} from 'node:os';import {readFileSync} from 'node:fs';
const root=process.argv[2];const {saveConfig,validProject}=await import(pathToFileURL(join(root,'scripts/launcher-resolver.mjs')).href);
if(!validProject(root))throw Error('Current project identity check failed');
const config=join(homedir(),'.config/codex-navigator/launcher.json');let old={};try{old=JSON.parse(readFileSync(config,'utf8'))}catch{}
saveConfig(config,root,old);
JS
cp "$TEMP_DIR/launcher.scpt" "$DEST/Contents/Resources/Scripts/main.scpt"
/usr/bin/osadecompile "$DEST/Contents/Resources/Scripts/main.scpt"
node "$DEST/Contents/Resources/launcher-resolver.mjs" --resolve
echo "Flexible Navigator launcher installed. Current app session was not restarted."
