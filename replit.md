# Image MetaData Removal Tool

## Overview
A privacy-focused web app to detect and remove EXIF metadata from images (JPG, PNG, WEBP). Built with Flask, Pillow, piexif, geopy, and APScheduler.

## Features
- Upload single or multiple images (drag & drop, browse, or Ctrl+V paste from clipboard)
- EXIF metadata extraction and display
- Privacy risk scoring (LOW / MEDIUM / HIGH) based on GPS, device info, timestamps
- Privacy risk score chart — session history bar chart per image
- GPS map preview (Google Maps embed) + reverse geocoding via geopy/Nominatim
- Batch GPS map — Leaflet + OpenStreetMap multi-marker map for bulk uploads with GPS
- Side-by-side metadata diff table — Before | Removed/Kept | After
- Metadata CSV export — download a full field-by-field report as .csv
- Before vs after image comparison slider with savings stats
- Remove ALL metadata, GPS only, or Custom Fields (field-level checkbox editor)
- Custom metadata editor — select exactly which EXIF fields to remove
- Format conversion — output as JPEG, PNG, or WebP regardless of input format
- Resize on clean — limit output image to a max width
- Optional image compression with quality slider
- Bulk processing with ZIP download
- Session history with re-download; "Get Original" undo button per entry
- PWA support (manifest.json + service worker, cache `imgmeta-v3`)
- API endpoint: POST /api/clean
- Auto-deletion of files after 1 hour (APScheduler safety-net)

## Tech Stack
- **Backend**: Python 3, Flask 3.1.1
- **Image processing**: Pillow 11.2.1, piexif 1.1.3
- **Geocoding**: geopy 2.4.1 (Nominatim)
- **Scheduler**: APScheduler 3.10.4
- **Maps**: Google Maps embed (single image GPS), Leaflet + OpenStreetMap (batch GPS)

## Project Structure
```
app.py                  Flask application entry point
main.py                 WSGI entry point
requirements.txt
templates/
  index.html            Main single-page UI (Leaflet CDN included)
static/
  style.css             Dark theme UI
  script.js             Frontend logic (all 9 features)
  icon-192.png          PWA icon
  icon-512.png          PWA icon
  favicon.ico / favicon.png
uploads/                User-uploaded files (auto-deleted)
cleaned/                Processed/cleaned files
utils/
  metadata.py           EXIF extraction + extract_metadata_fields()
  gps.py                GPS coordinate extraction and reverse geocoding
  risk.py               Privacy risk score calculation
  cleaner.py            remove_all_metadata / remove_gps_only / remove_custom_fields
  compressor.py         Image compression
  zip_utils.py          Bulk ZIP creation
  preview.py            Base64 preview generation
  cleanup.py            File auto-deletion logic
```

## API
- `POST /upload`      — upload image(s), returns metadata + metadata_fields + GPS + risk
- `POST /clean`       — clean single image (mode, output_format, max_width, fields_to_remove)
- `POST /bulk-clean`  — clean batch, returns ZIP (mode, output_format, max_width)
- `GET  /download/<f>` — serve cleaned file (deletes after read)
- `GET  /download-zip/<f>` — serve ZIP (deletes after read)
- `POST /api/clean`   — programmatic API (image file + mode + quality)

## Running
```
python main.py
```
