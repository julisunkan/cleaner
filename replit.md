# Image MetaData Removal Tool

## Overview
A privacy-focused web app to detect and remove EXIF metadata from images (JPG, PNG, WEBP). Built with Flask, Pillow, piexif, geopy, and APScheduler.

## Features
- Upload single or multiple images (drag & drop)
- EXIF metadata extraction and display
- Privacy risk scoring (LOW / MEDIUM / HIGH) based on GPS, device info, timestamps
- GPS map preview (Google Maps embed) + reverse geocoding via geopy/Nominatim
- Before vs after image comparison with savings stats
- Remove ALL metadata or GPS only
- Optional image compression with quality slider
- Bulk processing with ZIP download
- API endpoint: POST /api/clean
- Auto-deletion of files after 3 days (APScheduler)
- Live countdown timer (JavaScript)
- PWA support (manifest.json + service worker)

## Tech Stack
- **Backend**: Python 3, Flask 3.1.1
- **Image processing**: Pillow 11.2.1, piexif 1.1.3
- **Geocoding**: geopy 2.4.1 (Nominatim)
- **Scheduler**: APScheduler 3.10.4
- **Server**: Gunicorn 23.0.0

## Project Structure
```
app.py                  Flask application entry point
main.py                 WSGI entry point
requirements.txt
templates/
  index.html            Main single-page UI
  result.html           Fallback result page
static/
  style.css             Dark theme UI
  script.js             Frontend logic
  icon-192.png          PWA icon (placeholder)
  icon-512.png          PWA icon (placeholder)
uploads/                User-uploaded files (auto-deleted after 3 days)
cleaned/                Processed/cleaned files
utils/
  metadata.py           EXIF extraction
  gps.py                GPS coordinate extraction and reverse geocoding
  risk.py               Privacy risk score calculation
  cleaner.py            Metadata removal (all or GPS-only)
  compressor.py         Image compression
  zip_utils.py          Bulk ZIP creation
  cleanup.py            File auto-deletion logic
```

## Admin / API
- POST /api/clean — accepts `image` file, optional `mode` (all/gps) and `quality`
- Files auto-purged every 6 hours via APScheduler

## Running
```
python3 -m gunicorn --bind 0.0.0.0:5000 --reuse-port --reload main:app
```
