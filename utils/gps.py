from PIL import Image
import piexif


def _rational_to_float(rational):
    if isinstance(rational, tuple) and len(rational) == 2 and rational[1] != 0:
        return rational[0] / rational[1]
    return 0.0


def extract_gps_coordinates(filepath):
    try:
        img = Image.open(filepath)
        raw_exif = img.info.get("exif")
        if not raw_exif:
            return None

        exif_dict = piexif.load(raw_exif)
        gps_ifd = exif_dict.get("GPS", {})
        if not gps_ifd:
            return None

        lat_data = gps_ifd.get(piexif.GPSIFD.GPSLatitude)
        lat_ref  = gps_ifd.get(piexif.GPSIFD.GPSLatitudeRef)
        lon_data = gps_ifd.get(piexif.GPSIFD.GPSLongitude)
        lon_ref  = gps_ifd.get(piexif.GPSIFD.GPSLongitudeRef)

        if not (lat_data and lon_data):
            return None

        lat = (_rational_to_float(lat_data[0]) +
               _rational_to_float(lat_data[1]) / 60 +
               _rational_to_float(lat_data[2]) / 3600)
        lon = (_rational_to_float(lon_data[0]) +
               _rational_to_float(lon_data[1]) / 60 +
               _rational_to_float(lon_data[2]) / 3600)

        if isinstance(lat_ref, bytes):
            lat_ref = lat_ref.decode("utf-8", errors="replace").strip("\x00")
        if isinstance(lon_ref, bytes):
            lon_ref = lon_ref.decode("utf-8", errors="replace").strip("\x00")

        if lat_ref == "S":
            lat = -lat
        if lon_ref == "W":
            lon = -lon

        return {"lat": round(lat, 6), "lon": round(lon, 6)}

    except Exception:
        return None


def reverse_geocode(lat, lon):
    try:
        from geopy.geocoders import Nominatim
        geolocator = Nominatim(user_agent="image-metadata-tool/1.0")
        location = geolocator.reverse(f"{lat}, {lon}", timeout=5)
        return location.address if location else None
    except Exception:
        return None
