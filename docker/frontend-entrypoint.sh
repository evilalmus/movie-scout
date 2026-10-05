#!/bin/sh
set -eu
case "${DEMO:-false}" in true|false) ;; *) echo "DEMO must be true or false" >&2; exit 1;; esac
{
  printf 'window.MOVIE_SCOUT_CONFIG = '
  jq -n --arg apiBase "${API_BASE:-}" --argjson demo "${DEMO:-false}" '{apiBase:$apiBase,demo:$demo}'
  printf ';\n'
} > /tmp/movie-scout-config.js
exec "$@"
