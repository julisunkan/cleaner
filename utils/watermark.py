from PIL import Image, ImageStat, ImageFilter, ImageChops


def detect_watermark(filepath):
    """
    Heuristic watermark detection using PIL only (no ML required).

    Checks for:
      1. Semi-transparent alpha overlay (common PNG watermarks)
      2. Elevated edge density in corners (logo / text bug)
      3. Brightness anomaly in a mid-image diagonal band (diagonal text)
      4. Repeated pattern across all four corners (tiled watermark)

    Returns:
      {
        detected:    bool,
        confidence:  'NONE' | 'LOW' | 'MEDIUM' | 'HIGH',
        score:       int  (0-100),
        indicators:  [str],
      }
    """
    indicators = []
    score = 0

    try:
        img = Image.open(filepath)
        w, h = img.size

        if w < 32 or h < 32:
            return _clean()

        # ── 1. Alpha channel analysis ────────────────────────────────
        if img.mode in ('RGBA', 'LA'):
            alpha = img.split()[-1]
            stat  = ImageStat.Stat(alpha)
            mean_a   = stat.mean[0]
            stddev_a = stat.stddev[0]
            # Semi-transparent (not fully clear, not fully opaque) + some variance
            if 20 < mean_a < 230 and stddev_a > 10:
                score += 40
                indicators.append("Semi-transparent overlay layer detected in alpha channel")

        # ── 2. Edge density — corner vs centre ───────────────────────
        # Resize to a consistent size for fast, uniform analysis
        AW = min(w, 400)
        AH = min(h, 400)
        thumb = img.convert('L').resize((AW, AH), Image.LANCZOS)
        edges = thumb.filter(ImageFilter.FIND_EDGES)

        cw, ch = AW // 3, AH // 3

        def emean(x1, y1, x2, y2):
            return ImageStat.Stat(edges.crop((x1, y1, x2, y2))).mean[0]

        centre = max(emean(cw, ch, cw * 2, ch * 2), 0.5)
        corner_vals = {
            'top-left':     emean(0,      0,      cw,  ch),
            'top-right':    emean(AW - cw, 0,      AW,  ch),
            'bottom-left':  emean(0,      AH - ch, cw,  AH),
            'bottom-right': emean(AW - cw, AH - ch, AW, AH),
        }

        hottest_name = max(corner_vals, key=corner_vals.get)
        hottest_val  = corner_vals[hottest_name]
        ratio = hottest_val / centre

        if ratio > 2.8:
            score += 35
            indicators.append(
                f"High edge density in {hottest_name} corner — possible logo or text bug"
            )
        elif ratio > 1.9:
            score += 15
            indicators.append(f"Elevated detail in {hottest_name} region")

        # ── 3. Mid-image brightness anomaly (diagonal text band) ─────
        rgb         = img.convert('RGB')
        thumb_rgb   = rgb.resize((AW, AH), Image.LANCZOS)
        overall_std = sum(ImageStat.Stat(thumb_rgb).stddev) / 3

        mid_strip  = thumb_rgb.crop((0, AH // 3, AW, AH * 2 // 3))
        mid_std    = sum(ImageStat.Stat(mid_strip).stddev) / 3
        mid_edges  = ImageStat.Stat(
            edges.crop((0, AH // 3, AW, AH * 2 // 3))
        ).mean[0]

        # Mid-strip is unusually flat (low std) but has surprising edge content
        if (overall_std > 20
                and mid_std < overall_std * 0.5
                and mid_edges > centre * 1.5):
            score += 20
            indicators.append(
                "Text-like pattern detected across mid-image region"
            )

        # ── 4. Repeated corner patch (tiled watermark) ───────────────
        if AW >= 120 and AH >= 120:
            P = 40
            S = 20  # resize patches to 20×20 for fast comparison

            def patch(x, y):
                return thumb.crop((x, y, x + P, y + P)).resize((S, S))

            tl = patch(0,      0)
            tr = patch(AW - P, 0)
            bl = patch(0,      AH - P)
            br = patch(AW - P, AH - P)

            def pdiff(a, b):
                return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]

            avg_sim = (pdiff(tl, tr) + pdiff(tl, bl) + pdiff(tl, br)) / 3

            if avg_sim < 8:
                score += 25
                indicators.append(
                    "Repeating pattern across all corners — possible tiled watermark"
                )
            elif avg_sim < 14:
                score += 10
                indicators.append("Mild pattern repetition across corners")

        # ── Result ───────────────────────────────────────────────────
        score     = min(score, 100)
        detected  = score >= 30

        if score >= 70:
            confidence = 'HIGH'
        elif score >= 45:
            confidence = 'MEDIUM'
        elif score >= 25:
            confidence = 'LOW'
        else:
            confidence = 'NONE'
            detected   = False

        return {
            'detected':   detected,
            'confidence': confidence,
            'score':      score,
            'indicators': indicators,
        }

    except Exception:
        return _clean()


def _clean():
    return {'detected': False, 'confidence': 'NONE', 'score': 0, 'indicators': []}
