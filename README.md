# RagSpyVHF

A Raspberry Pi tool that uses a cheap USB radio receiver (SDR) to scan the 26–76 MHz frequency range, detect active radio signals, and let you listen to them from any web browser on your home network.

**What you can hear:**
- CB radio (27 MHz) — truckers, off-road convoys
- Amateur (ham) radio — 10m band (28–29.7 MHz) and 6m band (50–54 MHz)
- Land mobile and public safety radio (29.7–50 MHz)
- Various utility signals in the VHF low band (54–76 MHz)

---

## What you need

### Hardware

| Item | Notes | Approximate cost |
|------|-------|-----------------|
| Raspberry Pi 4 (2 GB or more) | Pi 3B+ works but is slower | £35–£55 |
| MicroSD card (16 GB, Class 10 or better) | Samsung or SanDisk recommended | £8–£12 |
| RTL-SDR USB dongle | The "RTL-SDR Blog V4" is the best beginner option | £25–£35 |
| Antenna | A simple wire antenna works; see the Antenna section below | £0–£15 |
| Power supply for the Pi | Official Pi 4 PSU (USB-C, 5V 3A) | £8–£10 |

> **A note on the Pi model:** Pi 5 also works. Pi 3B+ works but may feel sluggish. Pi Zero is not recommended — it lacks the processing power.

### Software you need on your normal computer (just for setup)

- **Raspberry Pi Imager** — free, downloads from [raspberrypi.com/software](https://www.raspberrypi.com/software/)
- A terminal / SSH client — on Windows use [PuTTY](https://www.putty.org/) or the built-in Windows Terminal; on Mac/Linux the built-in Terminal app is fine

---

## Part 1: Prepare the microSD card

### Step 1 — Download and open Raspberry Pi Imager

Install it on your normal computer and open it.

### Step 2 — Choose the OS

1. Click **"Choose OS"**
2. Select **"Raspberry Pi OS (other)"**
3. Select **"Raspberry Pi OS Lite (64-bit)"**

> Choose "Lite" — it has no desktop, which saves memory and CPU for the radio scanning. You will control everything over SSH (a text terminal connection from your computer).

### Step 3 — Configure before flashing (important!)

Before clicking Write, click the **settings gear icon** (or press Ctrl+Shift+X). Configure:

- **Set hostname:** e.g. `ragspyvhf` (you will use this to connect)
- **Enable SSH:** tick this box, use password authentication
- **Set username and password:** e.g. username `pi`, choose a password you will remember
- **Configure WiFi:** enter your home WiFi name and password (or skip if using Ethernet)
- **Set locale/timezone:** set to your country so the clock is correct

Click **Save**, then click **Write** and wait for it to finish (a few minutes).

### Step 4 — Insert the card and boot the Pi

1. Eject the SD card from your computer and insert it into the Pi
2. Plug in the RTL-SDR dongle into one of the Pi's USB ports
3. Connect an Ethernet cable if you are not using WiFi
4. Plug in the power supply — the Pi will boot automatically (there is no power button)
5. Wait about 60 seconds for the first boot to complete

---

## Part 2: Connect to the Pi

### Find the Pi's IP address

Open a browser on your computer and log into your home router (usually at `192.168.1.1` or `192.168.0.1`). Look for a connected device called `ragspyvhf` — note its IP address (something like `192.168.1.45`).

Alternatively, if your router supports it, you can often just use the hostname: `ragspyvhf.local`

### Connect via SSH

**On Windows (Windows Terminal or PuTTY):**
```
ssh pi@192.168.1.45
```
Or with the hostname:
```
ssh pi@ragspyvhf.local
```

**On Mac or Linux (Terminal):**
```bash
ssh pi@ragspyvhf.local
```

When prompted, type `yes` to accept the fingerprint, then enter the password you set in Raspberry Pi Imager.

You should now see a command prompt like:
```
pi@ragspyvhf:~$
```

Everything from here is typed into this SSH window.

---

## Part 3: Copy the RagSpyVHF files to the Pi

### Option A — Copy from your computer using SCP

On your computer (not the SSH window), open a second terminal and run:

```bash
scp -r /path/to/RagSpy pi@ragspyvhf.local:/home/pi/
```

Replace `/path/to/RagSpy` with wherever you downloaded/cloned this project.

### Option B — Use Git (if you have the project in a Git repository)

In the SSH window on the Pi:

```bash
sudo apt-get install -y git
git clone https://github.com/YOUR_USERNAME/RagSpyVHF.git /home/pi/RagSpy
```

### After copying, navigate to the project folder:

```bash
cd /home/pi/RagSpy
```

---

## Part 4: Run the installer

The installer sets up everything the Pi needs: the SDR software, Python, and the correct USB permissions.

```bash
sudo bash install.sh
```

You will see output like:
```
=== RagSpyVHF installer ===
[1/5] Installing system packages…
[2/5] Installing RTL-SDR udev rules…
[3/5] Blacklisting DVB kernel modules…
[4/5] Creating Python venv and installing dependencies…
[5/5] Checking for RTL-SDR dongle…
   Dongle detected OK.
```

> **What is the DVB module blacklist?** The Raspberry Pi OS recognises your RTL-SDR dongle as a TV tuner and loads drivers for it automatically. Those drivers conflict with the radio scanning software. The installer disables them. You do not need to do anything — it is handled automatically.

### Reboot after installing

```bash
sudo reboot
```

Wait 30 seconds, then SSH back in:

```bash
ssh pi@ragspyvhf.local
```

---

## Part 5: Start RagSpyVHF

Navigate to the project folder and start the app:

```bash
cd /home/pi/RagSpy
venv/bin/python main.py
```

You should see:
```
INFO:     RagSpyVHF starting up
INFO:     ScannerService started — scanning 26–76 MHz
INFO:     Uvicorn running on http://0.0.0.0:8080
```

Leave this SSH window open and running.

### Open the web interface

On any device connected to your home network (phone, tablet, laptop), open a browser and go to:

```
http://ragspyvhf.local:8080
```

Or use the IP address:

```
http://192.168.1.45:8080
```

You should see the RagSpyVHF interface with a waterfall display and signals panel. Within a minute or two, signals will start appearing if there is radio activity in your area.

---

## Part 6: Auto-start on boot (optional but recommended)

If you want RagSpyVHF to start automatically every time the Pi powers on, install it as a system service:

```bash
# Edit the service file to make sure the username is correct
# (replace 'ragnar' with your Pi username, e.g. 'pi')
nano /home/pi/RagSpy/ragspyvhf.service
```

Change the two lines that say `ragnar` to your username (e.g. `pi`), and update the paths if needed. Press `Ctrl+X`, then `Y`, then Enter to save.

Then install and enable the service:

```bash
sudo cp /home/pi/RagSpy/ragspyvhf.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ragspyvhf
sudo systemctl start ragspyvhf
```

Check it is running:

```bash
sudo systemctl status ragspyvhf
```

You should see `Active: active (running)`. From now on, RagSpyVHF will start automatically whenever the Pi boots — no SSH needed.

To view live logs:

```bash
journalctl -fu ragspyvhf
```

---

## Using the web interface

### Signals tab

When you open the interface you will see two main areas:

**Waterfall display** — a scrolling colour chart. Each horizontal line is a snapshot of the radio spectrum from 26 to 76 MHz. Bright colours (yellow, red) mean a strong signal is present at that frequency. Dark blue means no signal. The display updates in real time.

- Use the **Band** dropdown to zoom in on a specific part of the spectrum (CB radio, amateur 10m, etc.)
- Click anywhere on the waterfall to immediately tune in and listen to that frequency

**Active Signals panel** — a table listing every frequency where a signal has been detected. For each signal you can see:
- The frequency in MHz
- The signal type (CB, amateur, land mobile, etc.)
- The name or channel label where known (e.g. "CB Ch 19 — Truckers")
- The signal strength (SNR = signal-to-noise ratio, higher is better)
- The demodulation mode (AM for CB, NFM for most others, USB for ham SSB)
- A **Listen** button

### Audio tab

Click **Listen** on any signal (or click the waterfall) to switch to the Audio tab and start listening.

- Use the **Volume** slider to adjust playback level
- The **VU meter** bar shows audio activity — if it stays flat, the frequency may be silent
- Click **Stop** to stop listening and resume scanning

> **Note on audio:** The audio is raw digital radio — it will sound like static if the frequency is empty, and like voice or tones when something is transmitting. CB radio and amateur FM will sound like normal voice. SSB (single-sideband, used on amateur 10m) has a distinctive "Donald Duck" quality until you are tuned exactly to the right frequency.

---

## Antenna

The antenna makes a huge difference, especially below 50 MHz. The RTL-SDR's bundled antenna is usually optimised for higher frequencies and will pick up little on the 26–76 MHz range.

### Simple DIY antenna options

**Random wire antenna (easiest):**
Connect a length of wire (5–10 metres) to the RTL-SDR's SMA connector using an adapter. Drape it out of a window or along a wall. This will pick up a wide range of signals.

**Dipole antenna for CB/10m (best for 27–29 MHz):**
Two equal lengths of wire, each approximately **2.75 metres** long (total 5.5 m), connected at the centre to the feed cable. Hang horizontally. This gives the best results for CB and 10m amateur.

**For 6m amateur (50–54 MHz):**
Each dipole leg should be approximately **1.43 metres** long.

The RTL-SDR Blog V4 dongle comes with a dipole antenna kit that is adjustable — it is a good starting point.

---

## Troubleshooting

### "rtl_test did not detect a dongle" after install

The DVB kernel modules may still be loaded from before the reboot. After rebooting, try:

```bash
rtl_test -t
```

If it still fails:

```bash
sudo rmmod dvb_usb_rtl28xxu rtl2832 2>/dev/null
sudo udevadm trigger
rtl_test -t
```

If it still fails, unplug and replug the dongle, then try again.

### The waterfall shows nothing / no signals detected

- Make sure the antenna is connected to the RTL-SDR dongle
- Try a longer wire antenna
- The 26–76 MHz band is quieter than FM broadcast — you may need to wait for activity or move the antenna outdoors / near a window
- Check the gain setting in `config.py` — try increasing `DONGLE_GAIN` to `49.6`

### The web page does not load

- Make sure the app is running (`venv/bin/python main.py` shows no errors)
- Check you are on the same WiFi network as the Pi
- Try using the IP address instead of the hostname: `http://192.168.1.XX:8080`
- Check the Pi's firewall is not blocking port 8080: `sudo ufw allow 8080` (if ufw is enabled)

### Audio sounds robotic or cuts in and out

- This is normal for weak signals — the demodulated audio quality depends on signal strength
- Try adjusting the volume slider
- Check that your browser supports the Web Audio API (all modern browsers do — Chrome, Firefox, Safari, Edge)
- On some browsers, audio requires a user interaction before it can start. If no sound plays, click somewhere on the page first

### The scanner stops when I try to listen

This is expected behaviour. The RTL-SDR dongle can only do one thing at a time — it cannot scan and listen simultaneously. When you click Listen, scanning pauses. When you click Stop, scanning resumes automatically.

---

## Configuration

All settings are in `config.py`. You can edit it with:

```bash
nano /home/pi/RagSpy/config.py
```

Key settings:

| Setting | Default | What it does |
|---------|---------|-------------|
| `DONGLE_GAIN` | `49.6` | RF gain in dB. Higher = more sensitive but more noise. Try values between 20 and 49.6. |
| `PEAK_SNR_THRESHOLD_DB` | `15.0` | How many dB above the noise floor a signal must be to appear in the list. Lower = more signals detected (including false positives). |
| `SIGNAL_TIMEOUT_SEC` | `30` | How long to keep a signal in the list after it stops transmitting. |
| `PORT` | `8080` | Web interface port. |
| `VOICE_TIMEOUT_SEC` | `300` | Auto-stop listening after this many seconds (5 minutes). |

You can also override settings without editing the file by using environment variables:

```bash
RAGSPY_GAIN=40 RAGSPY_PORT=8080 venv/bin/python main.py
```

---

## Project structure (for reference)

```
RagSpy/
├── main.py                 # App entry point — start here
├── config.py               # All settings
├── install.sh              # One-time setup script
├── ragspyvhf.service       # systemd service file for autostart
├── requirements.txt        # Python package list
├── sdr/
│   ├── device_manager.py   # Manages the SDR dongle (only one process at a time)
│   ├── scanner.py          # Runs the frequency scan using rtl_power
│   ├── voice_decoder.py    # Tunes to a frequency and streams audio using rtl_fm
│   └── signal_classifier.py# Identifies signal type from frequency
├── api/
│   ├── routes_scan.py      # Web API for scanner data
│   ├── routes_voice.py     # Web API for audio streaming
│   └── routes_ws.py        # Real-time WebSocket connections
├── models/
│   ├── signal.py           # Data structure for a detected signal
│   └── device.py           # Data structure for device state
├── static/
│   ├── index.html          # The web interface page
│   ├── css/style.css       # Styling
│   └── js/
│       ├── app.js          # Main frontend logic
│       ├── waterfall.js    # Spectrum waterfall display
│       ├── signals.js      # Signals table
│       └── audio_player.js # Audio streaming and playback
└── data/
    └── band_allocations.json  # Frequency band definitions and CB channel list
```

---

## Legal notice

Listening to radio transmissions is legal in most countries for personal, non-commercial use. However, **acting on the content of certain transmissions** (e.g. private communications, encrypted traffic) may be restricted by law in your country. Always check the regulations that apply where you live. This tool is intended for hobby, educational, and amateur radio use.
