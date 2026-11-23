#!/bin/bash
# Lance une commande avec des limites strictes pour ne jamais saturer l'ordinateur :
# priorité minimale, 50 % d'un cœur au plus, 1,5 Go de mémoire au plus, 200 processus au plus, arrêt forcé après N secondes.
# Usage : tools/safe-run.sh <secondes> <commande...>
secs="$1"; shift
exec systemd-run --user --scope --quiet -p MemoryMax=1500M -p MemorySwapMax=0 -p CPUQuota=50% -p TasksMax=200 nice -n 19 timeout --kill-after=3 "$secs" "$@"
