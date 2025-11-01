#!/usr/bin/env bash
# This tells the system to run this script using bash (a shell program)

# Safety settings: exit on error, undefined variables cause errors, pipe failures cause errors
set -euo pipefail

/**
 * Show Startup Script
 * 
 * This is a convenience script that starts everything needed to run the visualizer.
 * Think of it like pressing "Play" on a music system - it starts all the components.
 * 
 * What it does:
 * 1. Starts the web server (Vite) so you can view the app in a browser
 * 2. Starts the OSC bridge server (for sending audio data to TouchDesigner)
 * 3. Opens the control page in your default browser
 * 
 * Usage: Run this script from anywhere, and it will set everything up for you.
 */

# Simple show startup helper:
# 1) starts vite dev server (port 5173)
# 2) starts OSC bridge
# 3) opens control page in default browser

# Figure out where the project root directory is
# This script lives in scripts/, so we go up one level to find the project root
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Step 1: Start the web development server
# This runs "npm run dev" which starts Vite on port 5173
# The & at the end runs it in the background so we can continue
# >/dev/null 2>&1 redirects output so it doesn't clutter the terminal
echo "[show] Starting visualizer (Vite dev server)"
(
  cd "$ROOT_DIR"
  npm run dev &
) >/dev/null 2>&1 &

# Wait 1 second to let the server start up
sleep 1

# Step 2: Start the OSC bridge
# This is a separate server that converts WebSocket messages to OSC for TouchDesigner
# It runs in the tools/ directory
echo "[show] Starting OSC bridge"
(
  cd "$ROOT_DIR/tools"
  npm start &
) >/dev/null 2>&1 &

# Wait 2 seconds for both servers to be ready
sleep 2

# Step 3: Open the control page in the default browser
# The ?control=1 parameter tells the app to run in "control" mode
echo "[show] Opening control page"
open "http://localhost:5173/?control=1"

# Friendly reminder about the projector feature
echo "[show] Done. Use Settings → Session → Open Projector to link a receiver window."


