import piexif
from PIL import Image
from datetime import datetime


FRIENDLY_TAGS = {
    "0th": {
        271:  "Camera Make",
        272:  "Camera Model",
        274:  "Orientation",
        282:  "X Resolution",
        283:  "Y Resolution",
        296:  "Resolution Unit",
        305:  "Software",
        306:  "Date/Time",
        315:  "Artist",
        316:  "Host Computer",
        319:  "Predictor",
        529:  "YCbCr Coefficients",
        532:  "Reference Black/White",
        33432: "Copyright",
    },
    "Exif": {
        33434: "Exposure Time",
        33437: "F-Number",
        34850: "Exposure Program",
        34855: "ISO Speed",
        36864: "Exif Version",
        36867: "Date/Time Original",
        36868: "Date/Time Digitized",
        37121: "Components Config",
        37122: "Compressed BPP",
        37377: "Shutter Speed",
        37378: "Aperture",
        37379: "Brightness",
        37380: "Exposure Bias",
        37381: "Max Aperture",
        37383: "Metering Mode",
        37384: "Light Source",
        37385: "Flash",
        37386: "Focal Length",
        37396: "Subject Area",
        37500: "Maker Note",
        37510: "User Comment",
        37520: "Sub-Sec Time",
        37521: "Sub-Sec Time Original",
        37522: "Sub-Sec Time Digitized",
        40960: "Flashpix Version",
        40961: "Color Space",
        40962: "Pixel X Dimension",
        40963: "Pixel Y Dimension",
        40965: "Interop Offset",
        41483: "Flash Energy",
        41486: "Focal Plane X Res",
        41487: "Focal Plane Y Res",
        41488: "Focal Plane Res Unit",
        41492: "Subject Location",
        41495: "Sensing Method",
        41728: "File Source",
        41729: "Scene Type",
        41730: "CFA Pattern",
        41985: "Custom Rendered",
        41986: "Exposure Mode",
        41987: "White Balance",
        41988: "Digital Zoom Ratio",
        41989: "Focal Length (35mm)",
        41990: "Scene Capture Type",
        41991: "Gain Control",
        41992: "Contrast",
        41993: "Saturation",
        41994: "Sharpness",
        41995: "Device Setting",
        41996: "Subject Distance Range",
        42016: "Unique Image ID",
        42032: "Camera Owner Name",
        42033: "Body Serial Number",
        42034: "Lens Specification",
        42035: "Lens Make",
        42036: "Lens Model",
        42037: "Lens Serial Number",
    },
    "GPS": {
        0:  "GPS Version",
        1:  "GPS Latitude Ref",
        2:  "GPS Latitude",
        3:  "GPS Longitude Ref",
        4:  "GPS Longitude",
        5:  "GPS Altitude Ref",
        6:  "GPS Altitude",
        7:  "GPS Timestamp",
        8:  "GPS Satellites",
        9:  "GPS Status",
        10: "GPS Measure Mode",
        11: "GPS DOP",
        12: "GPS Speed Ref",
        13: "GPS Speed",
        16: "GPS Track Ref",
        17: "GPS Track",
        23: "GPS Img Direction Ref",
        24: "GPS Img Direction",
        27: "GPS Processing Method",
        29: "GPS Date Stamp",
        31: "GPS H Positioning Error",
    },
    "1st": {},
}


def _decode_value(val):
    if isinstance(val, bytes):
        try:
            decoded = val.decode("utf-8", errors="replace").strip("\x00").strip()
            return decoded if decoded else f"<bytes len={len(val)}>"
        except Exception:
            return f"<bytes len={len(val)}>"
    if isinstance(val, tuple):
        if len(val) == 2 and isinstance(val[0], int) and isinstance(val[1], int) and val[1] != 0:
            return f"{val[0]/val[1]:.4f}".rstrip("0").rstrip(".")
        return str(val)
    return str(val)


def extract_metadata(filepath):
    result = {}
    try:
        img = Image.open(filepath)
        result["image_info"] = {
            "Format": img.format or "Unknown",
            "Mode": img.mode,
            "Width": img.width,
            "Height": img.height,
        }
        raw_exif = img.info.get("exif")
        if not raw_exif:
            return result

        exif_dict = piexif.load(raw_exif)
        for ifd_name, ifd_data in exif_dict.items():
            if not isinstance(ifd_data, dict):
                continue
            friendly_map = FRIENDLY_TAGS.get(ifd_name, {})
            for tag_id, value in ifd_data.items():
                label = friendly_map.get(tag_id, f"Tag {tag_id}")
                result[f"{ifd_name}:{label}"] = _decode_value(value)
    except Exception as e:
        result["_error"] = str(e)
    return result


def extract_metadata_fields(filepath):
    """Return a list of {key, label, value, is_gps} dicts for the custom editor.
    key is in the format 'ifd_name:tag_id' used by remove_custom_fields()."""
    fields = []
    try:
        img = Image.open(filepath)
        raw_exif = img.info.get("exif")
        if not raw_exif:
            return fields
        exif_dict = piexif.load(raw_exif)
        for ifd_name, ifd_data in exif_dict.items():
            if not isinstance(ifd_data, dict):
                continue
            friendly_map = FRIENDLY_TAGS.get(ifd_name, {})
            for tag_id, value in ifd_data.items():
                label = friendly_map.get(tag_id, f"Tag {tag_id}")
                fields.append({
                    "key":    f"{ifd_name}:{tag_id}",
                    "label":  label,
                    "ifd":    ifd_name,
                    "tag_id": tag_id,
                    "value":  _decode_value(value),
                    "is_gps": ifd_name == "GPS",
                })
    except Exception:
        pass
    return fields


def get_raw_exif_dict(filepath):
    try:
        img = Image.open(filepath)
        raw_exif = img.info.get("exif")
        if not raw_exif:
            return None
        return piexif.load(raw_exif)
    except Exception:
        return None
