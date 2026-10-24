#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 ToolHub 品牌图：社交分享大图 (og.png) 与 PWA/iOS 图标
用法：python scripts/build-og.py
依赖：Pillow
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_REG = 'C:/Windows/Fonts/msyh.ttc'
FONT_EN_BOLD = 'C:/Windows/Fonts/arialbd.ttf'
FONT_EN = 'C:/Windows/Fonts/arial.ttf'

W, H = 1200, 630


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, top, bottom, diagonal=True):
    w, h = size
    img = Image.new('RGB', size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        for_t = y / h
        d.line([(0, y), (w, y)], fill=lerp(top, bottom, for_t))
    if diagonal:
        overlay = Image.new('RGB', size, (0, 0, 0))
        od = ImageDraw.Draw(overlay)
        for x in range(w):
            t = x / w
            od.line([(x, 0), (x, h)], fill=lerp((0, 0, 0), (40, 60, 160), t * 0.55))
        img = Image.blend(img, overlay, 0.28)
    return img


def radial_glow(img, center, radius, color, alpha=90):
    glow = Image.new('L', img.size, 0)
    gd = ImageDraw.Draw(glow)
    cx, cy = center
    steps = 60
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(alpha * (1 - i / steps) ** 1.6)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=a)
    tint = Image.new('RGB', img.size, color)
    img.paste(tint, (0, 0), glow)
    return img


def gear(draw, cx, cy, r_out, r_in_hole, teeth=8, color=(255, 255, 255), tooth_h=None):
    tooth_h = tooth_h or r_out * 0.28
    for i in range(teeth):
        ang = 2 * math.pi * i / teeth
        # 齿：以中心为轴的矩形，用多边形近似
        w2 = math.pi / teeth * 0.55
        pts = []
        for da, rr in [(-w2, r_out), (-w2 * 0.62, r_out + tooth_h), (w2 * 0.62, r_out + tooth_h), (w2, r_out)]:
            a = ang + da
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        draw.polygon(pts, fill=color)
    draw.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=color)
    draw.ellipse([cx - r_in_hole, cy - r_in_hole, cx + r_in_hole, cy + r_in_hole], fill=None)


def make_og():
    img = gradient((W, H), (10, 16, 30), (16, 22, 38))
    img = radial_glow(img, (980, 90), 520, (60, 90, 220), alpha=110)
    img = radial_glow(img, (120, 600), 420, (120, 60, 200), alpha=70)
    d = ImageDraw.Draw(img)

    # 细网格装饰（RGBA 叠加，真实低透明度）
    grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd2 = ImageDraw.Draw(grid)
    for x in range(0, W, 48):
        gd2.line([(x, 0), (x, H)], fill=(255, 255, 255, 13))
    for y in range(0, H, 48):
        gd2.line([(0, y), (W, y)], fill=(255, 255, 255, 13))
    img = Image.alpha_composite(img.convert('RGBA'), grid).convert('RGB')
    d = ImageDraw.Draw(img)

    # 左侧强调竖条
    d.rounded_rectangle([72, 150, 80, 470], radius=4, fill=(88, 130, 255))

    # 齿轮图标（RGBA 图层绘制后挖空中心）
    gear_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gld = ImageDraw.Draw(gear_layer)
    gear(gld, 130, 300, 44, 0, teeth=9, color=(226, 236, 255, 255), tooth_h=14)
    gld.ellipse([130 - 19, 300 - 19, 130 + 19, 300 + 19], fill=(0, 0, 0, 0))
    img = Image.alpha_composite(img.convert('RGBA'), gear_layer).convert('RGB')
    d = ImageDraw.Draw(img)

    f_title = ImageFont.truetype(FONT_EN_BOLD, 92)
    f_sub_cn = ImageFont.truetype(FONT_BOLD, 40)
    f_sub_en = ImageFont.truetype(FONT_EN, 30)
    f_badge = ImageFont.truetype(FONT_BOLD, 22)
    f_small = ImageFont.truetype(FONT_EN, 24)

    panel = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle([96, 160, 1010, 500], radius=26, fill=(8, 12, 24, 132))
    img = Image.alpha_composite(img.convert('RGBA'), panel).convert('RGB')
    d = ImageDraw.Draw(img)
    # 齿轮置于底板之上，保持纯白
    img = Image.alpha_composite(img.convert('RGBA'), gear_layer).convert('RGB')
    d = ImageDraw.Draw(img)

    x0 = 210
    d.text((x0, 196), 'ToolHub', font=f_title, fill=(255, 255, 255))
    d.text((x0, 312), '开源工具 · 打开即用', font=f_sub_cn, fill=(170, 190, 235))
    d.text((x0, 372), 'Open-source tools that run in your browser', font=f_sub_en, fill=(130, 150, 190))

    # 徽章
    badges = ['84 tools', 'runs locally', 'bilingual', 'PWA / offline']
    bx, by = x0, 448
    for b in badges:
        bb = d.textbbox((0, 0), b, font=f_badge)
        bw = bb[2] - bb[0] + 34
        d.rounded_rectangle([bx, by, bx + bw, by + 44], radius=22, fill=(30, 41, 69), outline=(70, 100, 170))
        d.text((bx + 17, by + 9), b, font=f_badge, fill=(150, 190, 255))
        bx += bw + 14

    d.text((x0, 566), 'No install · No sign-up · Data never leaves your device', font=f_small, fill=(110, 128, 160))

    img.save(os.path.join(OUT, 'og.png'), 'PNG', optimize=True)

    # 英文版（供英文分享场景复用）
    img2 = img.copy()
    d2 = ImageDraw.Draw(img2)
    d2.rectangle([x0 - 10, 300, W, 410], fill=lerp((16, 22, 38), (40, 60, 160), 0.15))
    img2.save(os.path.join(OUT, 'og-en.png'), 'PNG', optimize=True)
    return True


def make_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * 0.06)
    r = int(size * 0.22)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=r, fill=(37, 99, 235))
    # 顶部高光
    hl = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.rounded_rectangle([pad, pad, size - pad, size // 2], radius=r, fill=(255, 255, 255, 26))
    img = Image.alpha_composite(img, hl)
    d = ImageDraw.Draw(img)
    cx = cy = size // 2
    gear_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gld = ImageDraw.Draw(gear_layer)
    gear(gld, cx, cy, size * 0.19, 0, teeth=8, color=(255, 255, 255, 255), tooth_h=size * 0.06)
    hole = size * 0.075
    gld.ellipse([cx - hole, cy - hole, cx + hole, cy + hole], fill=(0, 0, 0, 0))
    img = Image.alpha_composite(img, gear_layer)
    return img


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    make_og()
    make_icon(512).save(os.path.join(OUT, 'icon-512.png'), 'PNG', optimize=True)
    make_icon(180).save(os.path.join(OUT, 'icon-180.png'), 'PNG', optimize=True)
    for f in ['og.png', 'og-en.png', 'icon-512.png', 'icon-180.png']:
        p = os.path.join(OUT, f)
        print('✓', f, round(os.path.getsize(p) / 1024, 1), 'KB')
