#!/bin/bash
# build.sh <name>  -> <name>.pptx, <name>.pdf, contact sheets
set -e
cd "$(dirname "$0")"
export PPTX_SKILL="C:/Users/ujo21/.claude/skills/synced/380b10af-9d68-4bd2-88ee-b173ccd00541_55f00856-5b52-491b-8000-86e0443e4c5f/pptx"
export NODE_PATH="$(pwd -W)/node_modules"
node $1.js "$(pwd -W)/$1.pptx"
py "$PPTX_SKILL/scripts/office/validate.py" $1.pptx | tail -1
rm -f $1.pdf
powershell -ExecutionPolicy Bypass -File topdf.ps1 -In "$(pwd -W)/$1.pptx" -Out "$(pwd -W)/$1.pdf"
rm -f $1-*.jpg $1_sheet*.png
pdftoppm -jpeg -r 70 $1.pdf $1
py sheet.py $1
