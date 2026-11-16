"""
@file scripts/crop_characters.py
@description characters/sanrio.png (8열 x 5행, 총 40종) 원본 시트에서 하단 영문 이름과 각주 기호(*)를 제거하고,
각 캐릭터의 시각적 바운딩 박스를 정밀 검출하여 240x240 정사각형 중앙에 배치한 개별 PNG(characters/cropped/01.png~40.png)를 생성합니다.
"""

import os
import csv
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_PATH = os.path.join(ROOT_DIR, "characters", "sanrio.png")
CSV_PATH = os.path.join(ROOT_DIR, "characters", "sanrio.cvs")
OUT_DIR = os.path.join(ROOT_DIR, "characters", "cropped")

CANVAS_SIZE = 240
PADDING = 18

ROW_X_SPLITS = [
    [3, 121, 242, 362, 484, 604, 725, 841, 962],
    [3, 128, 242, 362, 483, 604, 724, 848, 962],
    [3, 121, 242, 362, 483, 604, 724, 845, 962],
    [3, 123, 242, 368, 490, 613, 724, 845, 962],
    [3, 121, 245, 375, 483, 604, 731, 864, 962],
]

ROW_FULL_BANDS = [
    (2, 161, 117),
    (161, 323, 280),
    (323, 488, 442),
    (488, 647, 606),
    (647, 778, 755),
]


def compute_clean_fg_mask(cell_rgb: np.ndarray) -> np.ndarray:
    """단일 픽셀 노이즈를 제거한 실제 캐릭터 전경 마스크를 반환합니다."""
    gray = cell_rgb.mean(axis=2)
    mx = cell_rgb.max(axis=2).astype(int)
    mn = cell_rgb.min(axis=2).astype(int)
    raw = (gray < 243) | ((mx - mn) > 16)

    padded = np.pad(raw.astype(np.uint8), 1, mode="constant", constant_values=0)
    nbr_sum = (
        padded[0:-2, 0:-2] + padded[0:-2, 1:-1] + padded[0:-2, 2:]
        + padded[1:-1, 0:-2] + padded[1:-1, 1:-1] + padded[1:-1, 2:]
        + padded[2:, 0:-2] + padded[2:, 1:-1] + padded[2:, 2:]
    )
    return raw & (nbr_sum >= 4)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    im = Image.open(IMG_PATH).convert("RGBA")
    arr = np.array(im)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = (arr[:, :, :3] * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)

    # 외곽 테두리 노이즈 정리
    rgb[0:2, :, :] = 255
    rgb[:, 0:3, :] = 255
    rgb[:, 962:, :] = 255
    non_white = rgb.mean(axis=2) < 242

    meta_rows = []
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        next(reader, None)
        for row in reader:
            if len(row) >= 8:
                meta_rows.append({"row": int(row[0]), "col": int(row[1]), "koName": row[3].strip()})

    for idx, meta in enumerate(meta_rows):
        r = meta["row"] - 1
        c = meta["col"] - 1
        ry0, ry1, cy_approx = ROW_FULL_BANDS[r]
        x0, x1 = ROW_X_SPLITS[r][c], ROW_X_SPLITS[r][c + 1]

        if r == 0 and c == 6:
            # Deery-Lou (오른쪽 귀와 Pinki Lili의 꿀벌/끈 대각선 분리)
            cell_rgb = rgb[2:118, 725:841].copy()
            cell_rgb[40:, 823 - 725 :, :] = 255
        elif r == 0 and c == 7:
            # Pinki Lili (꿀벌 및 끈 전체 보존, 좌상단 Deery-Lou 귀 마스킹)
            cell_rgb = rgb[2:116, 823:962].copy()
            cell_rgb[:41, : 841 - 823, :] = 255
        else:
            row_ink = non_white[ry0:ry1, x0:x1].sum(axis=1)
            expected_gap = cy_approx - ry0
            s0 = max(45, expected_gap - 20)
            s1 = min(ry1 - ry0 - 8, expected_gap + 10)
            zero_ys = [y for y in range(s0, s1 + 1) if row_ink[y] == 0]
            cut_rel_y = zero_ys[0] if zero_ys else (s0 + int(np.argmin(row_ink[s0 : s1 + 1])))
            cell_rgb = rgb[ry0 : ry0 + cut_rel_y, x0:x1].copy()

            # Pannapitta 우하단 '*' 기호 제거
            if r == 1 and c == 7:
                cell_rgb[92:, 80:, :] = 255

        fg_mask = compute_clean_fg_mask(cell_rgb)
        ys, xs = np.where(fg_mask)
        bx0, bx1 = int(xs.min()), int(xs.max()) + 1
        by0, by1 = int(ys.min()), int(ys.max()) + 1

        mask_im = Image.fromarray((fg_mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
        keep_mask = np.array(mask_im) > 0
        cleaned = cell_rgb.copy()
        cleaned[~keep_mask] = 255

        tight = cleaned[
            max(0, by0 - 1) : min(cleaned.shape[0], by1 + 1),
            max(0, bx0 - 1) : min(cleaned.shape[1], bx1 + 1),
        ]
        tw, th = tight.shape[1], tight.shape[0]
        target_box = CANVAS_SIZE - 2 * PADDING
        scale = min(target_box / tw, target_box / th)
        nw = max(1, int(round(tw * scale)))
        nh = max(1, int(round(th * scale)))

        resized = Image.fromarray(tight).resize((nw, nh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (255, 255, 255, 255))
        canvas.paste(resized.convert("RGBA"), ((CANVAS_SIZE - nw) // 2, (CANVAS_SIZE - nh) // 2))

        # 네 모서리에서 외곽 흰 배경만 투명(Alpha=0)으로 Flood-Fill 처리하여 내부 흰색(헬로키티 얼굴 등)은 보존
        for seed in [(0, 0), (CANVAS_SIZE - 1, 0), (0, CANVAS_SIZE - 1), (CANVAS_SIZE - 1, CANVAS_SIZE - 1)]:
            if canvas.getpixel(seed)[3] > 0:
                ImageDraw.floodfill(canvas, seed, (255, 255, 255, 0), thresh=8)

        out_path = os.path.join(OUT_DIR, f"{idx + 1:02d}.png")
        canvas.save(out_path, optimize=True)

    print(f"[Crop Complete] {len(meta_rows)} character images saved to {OUT_DIR}")


if __name__ == "__main__":
    main()
