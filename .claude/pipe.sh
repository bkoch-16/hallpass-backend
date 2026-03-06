#!/bin/bash
root=$(git rev-parse --show-toplevel)
f=$(realpath "$root/$1" 2>/dev/null)
[[ "$f" == "$root"/* ]] && cat "$f" || echo "Error: path must be within the repository"