#!/usr/bin/env bash
# install.sh — RagSpyVHF system setup for Raspberry Pi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="${SUDO_USER:-$USER}"

echo "=== RagSpyVHF installer ==="
echo "Installing for user: ${SERVICE_USER}"
echo "Project dir: ${SCRIPT_DIR}"
echo

# ── System packages ───────────────────────────────────────────────────────────
echo "[1/5] Installing system packages…"
apt-get update -qq
apt-get install -y --no-install-recommends \
    rtl-sdr \
    python3 \
    python3-pip \
    python3-venv \
    udev

# ── RTL-SDR udev rules (allow non-root access) ────────────────────────────────
echo "[2/5] Installing RTL-SDR udev rules…"
cat > /etc/udev/rules.d/20-rtlsdr.rules << 'EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2832", GROUP="plugdev", MODE="0666", SYMLINK+="rtl_sdr"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2838", GROUP="plugdev", MODE="0666", SYMLINK+="rtl_sdr"
EOF
udevadm control --reload-rules
udevadm trigger
usermod -a -G plugdev "${SERVICE_USER}" 2>/dev/null || true
echo "   udev rules installed. You may need to replug the RTL-SDR dongle."

# ── Blacklist DVB kernel modules (they grab the dongle before rtl-sdr can) ──
echo "[3/5] Blacklisting DVB kernel modules…"
cat > /etc/modprobe.d/blacklist-rtlsdr.conf << 'EOF'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
EOF
echo "   DVB modules blacklisted."

# ── Python virtual environment ───────────────────────────────────────────────
echo "[4/5] Creating Python venv and installing dependencies…"
VENV="${SCRIPT_DIR}/venv"
python3 -m venv "${VENV}"
"${VENV}/bin/pip" install --quiet --upgrade pip
"${VENV}/bin/pip" install --quiet -r "${SCRIPT_DIR}/requirements.txt"
echo "   venv ready at ${VENV}"

# ── Validate RTL-SDR dongle ──────────────────────────────────────────────────
echo "[5/5] Checking for RTL-SDR dongle…"
# Unload DVB modules now (blacklist only takes effect after reboot)
rmmod dvb_usb_rtl28xxu rtl2832 rtl2830 2>/dev/null || true
udevadm trigger
sleep 1
if rtl_test -t 2>&1 | grep -q "Found"; then
    echo "   Dongle detected OK."
else
    echo "   WARNING: rtl_test did not detect a dongle."
    echo "   Ensure the RTL-SDR is plugged in."
    echo "   If the issue persists, reboot and run: rtl_test -t"
fi

# ── systemd service ──────────────────────────────────────────────────────────
echo
echo "To install as a systemd service, run:"
echo "   sudo cp ${SCRIPT_DIR}/ragspyvhf.service /etc/systemd/system/"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable --now ragspyvhf"
echo
echo "To start manually:"
echo "   ${VENV}/bin/python ${SCRIPT_DIR}/main.py"
echo
echo "=== Installation complete ==="
