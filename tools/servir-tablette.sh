#!/bin/bash
# Sert le prototype sur le réseau local pour l'ouvrir depuis une tablette (même Wi-Fi). Arrêt : Ctrl+C.
# Limites : 20 % d'un cœur, 300 Mo, priorité minimale.
cd "$(dirname "$0")/.." || exit 1
[ -f dist/proto/index.html ] || node tools/build.mjs || exit 1
ip=$(hostname -I | awk '{print $1}')
echo "Ouvrez sur la tablette : http://$ip:8123/"
exec systemd-run --user --scope --quiet -p MemoryMax=300M -p CPUQuota=20% -p TasksMax=20 nice -n 19 python3 -m http.server 8123 --bind 0.0.0.0 --directory dist/proto
