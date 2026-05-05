def calculate_risk_score(metadata: dict) -> dict:
    score = 0
    factors = []

    has_gps = any("GPS:" in k and "Version" not in k for k in metadata)
    if has_gps:
        score += 40
        factors.append("GPS location data detected")

    device_keys = ["0th:Camera Make", "0th:Camera Model", "Exif:Body Serial Number", "Exif:Lens Serial Number"]
    found_device = [k for k in device_keys if k in metadata]
    if found_device:
        score += 20
        factors.append(f"Device info: {', '.join(d.split(':')[1] for d in found_device)}")

    timestamp_keys = ["0th:Date/Time", "Exif:Date/Time Original", "Exif:Date/Time Digitized"]
    found_ts = [k for k in timestamp_keys if k in metadata]
    if found_ts:
        score += 15
        factors.append("Timestamp information present")

    if "0th:Software" in metadata:
        score += 10
        factors.append("Software version exposed")

    if "0th:Artist" in metadata or "0th:Copyright" in metadata:
        score += 10
        factors.append("Author/copyright metadata present")

    if "Exif:User Comment" in metadata or "Exif:Maker Note" in metadata:
        score += 5
        factors.append("User comments / maker notes present")

    if score >= 50:
        level = "HIGH"
        color = "#e53e3e"
        badge = "🔴"
        description = "This image contains highly sensitive metadata including location or device identifiers."
    elif score >= 20:
        level = "MEDIUM"
        color = "#dd6b20"
        badge = "🟠"
        description = "Moderate privacy risk. Some identifying metadata is present."
    else:
        level = "LOW"
        color = "#38a169"
        badge = "🟢"
        description = "Low privacy risk. Minimal identifying metadata detected."

    return {
        "level": level,
        "score": min(score, 100),
        "color": color,
        "badge": badge,
        "description": description,
        "factors": factors,
    }
