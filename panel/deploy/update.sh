#!/usr/bin/env bash
# Обновление CRM до последней версии из GitHub: bash /root/pulsecar-crm/panel/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
git pull --ff-only
bash panel/deploy/install.sh
