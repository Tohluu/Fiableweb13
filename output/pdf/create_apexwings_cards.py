"""Create ApexWings print artwork, an imposed A4 sheet and a flat preview."""
from pathlib import Path
from io import BytesIO
import json

from PIL import Image, ImageDraw
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
import fitz

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
TMP = ROOT / 'tmp' / 'pdfs' / 'apexwings-card'
TMP.mkdir(parents=True, exist_ok=True)
NAVY = HexColor('#0c2d51')
BLUE = HexColor('#1769e0')
CYAN = HexColor('#42c5f5')
PALE = HexColor('#edf5fd')
MUTED = HexColor('#bcd2e7')
W, H, BLEED = 90 * mm, 50 * mm, 3 * mm
PHONE = '+234 701 541 4492'
WHATSAPP = 'https://wa.me/2347015414492'
LOGO = ROOT / 'images' / 'apexwings-logo.png'
pdfmetrics.registerFont(TTFont('Segoe', 'C:/Windows/Fonts/segoeui.ttf'))
pdfmetrics.registerFont(TTFont('SegoeBold', 'C:/Windows/Fonts/segoeuib.ttf'))


def text(c, value, x, y, size, color=NAVY, bold=False, tracking=None):
    c.setFillColor(color)
    t = c.beginText(x * mm, y * mm)
    t.setFont('SegoeBold' if bold else 'Segoe', size)
    if tracking is not None:
        t.setCharSpace(tracking)
    t.textOut(value)
    c.drawText(t)


def polygon(c, pts, color):
    c.setFillColor(color)
    p = c.beginPath()
    p.moveTo(pts[0][0] * mm, pts[0][1] * mm)
    for x, y in pts[1:]:
        p.lineTo(x * mm, y * mm)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M,
                   box_size=12, border=4)
qr.add_data(WHATSAPP)
qr.make(fit=True)
QR_MATRIX = qr.get_matrix()


def draw_qr(c, x, y, side):
    # Vector modules and a four-module quiet zone preserve sharpness in print.
    c.setFillColor(white)
    c.rect(x * mm, y * mm, side * mm, side * mm, stroke=0, fill=1)
    module = side * mm / len(QR_MATRIX)
    c.setFillColor(HexColor('#071a2e'))
    for row, cells in enumerate(QR_MATRIX):
        for col, filled in enumerate(cells):
            if filled:
                c.rect(x * mm + col * module,
                       y * mm + (len(QR_MATRIX) - row - 1) * module,
                       module, module, stroke=0, fill=1)


def draw_card(c, side):
    c.saveState()
    c.setFillColor(white if side == 'front' else NAVY)
    c.rect(-BLEED, -BLEED, W + 2 * BLEED, H + 2 * BLEED, fill=1, stroke=0)
    if side == 'front':
        # Existing logo is embedded unchanged; all other typography is live text.
        lw = 50 * mm
        with Image.open(LOGO) as im:
            lh = lw * im.height / im.width
        c.drawImage(str(LOGO), (W - lw) / 2, 12.3 * mm, lw, lh, mask='auto')
        polygon(c, [(84,53),(93,53),(93,29),(84,38)], BLUE)
        polygon(c, [(-3,20),(0,23),(0,53),(-3,53)], PALE)
        c.setFillColor(NAVY)
        c.rect(-BLEED, -BLEED, W + 2 * BLEED, 11 * mm, fill=1, stroke=0)
        tagline = 'RELIABLE DELIVERIES. SMARTER BUSINESS GROWTH.'
        font_size = 6.55
        width = pdfmetrics.stringWidth(tagline, 'SegoeBold', font_size)
        text(c, tagline, (W - width) / (2 * mm), 3.2, font_size, white, True)
    else:
        c.setFillColor(BLUE)
        c.rect(-BLEED, -BLEED, 4.3 * mm, H + 2 * BLEED, fill=1, stroke=0)
        polygon(c, [(81,53),(93,53),(93,38)], BLUE)
        text(c, 'You take the order.', 6, 39.4, 13.2, white, True)
        text(c, 'We take it there.', 6, 32.6, 13.2, white, True)
        text(c, 'Subscription & single deliveries', 6, 25.3, 7.25, MUTED)
        text(c, 'Bulk haulage', 6, 20.8, 7.25, MUTED)
        c.setStrokeColor(HexColor('#345673'))
        c.setLineWidth(0.45)
        c.line(6 * mm, 17.4 * mm, 84 * mm, 17.4 * mm)
        text(c, 'CALL / WHATSAPP', 6, 13, 6.1, CYAN, True, 0.65)
        text(c, PHONE, 6, 7.0, 12.1, white, True)
        draw_qr(c, 64, 22.0, 20)
        text(c, 'SCAN TO CHAT', 65.0, 19.2, 5.8, MUTED, True, 0.35)
        text(c, 'Lagos, Nigeria', 65.1, 7.4, 7.0, MUTED)
        c.linkURL(WHATSAPP, (64*mm,22*mm,84*mm,42*mm), relative=1)
        c.linkURL('tel:+2347015414492', (6*mm,6*mm,54*mm,12*mm), relative=1)
    c.restoreState()


def metadata(c, title):
    c.setTitle(title)
    c.setAuthor('ApexWings Logistics')
    c.setSubject('90 x 50 mm business card. Official logo and WhatsApp contact.')


def press_pdf():
    raw = TMP / 'press-unboxed.pdf'
    c = canvas.Canvas(str(raw), pagesize=(W + 2 * BLEED, H + 2 * BLEED),
                      pageCompression=1, pdfVersion=(1, 4))
    metadata(c, 'ApexWings business card - front and back - 3 mm bleed')
    for side in ['front', 'back']:
        c.saveState()
        c.translate(BLEED, BLEED)
        draw_card(c, side)
        c.restoreState()
        c.showPage()
    c.save()
    reader = PdfReader(raw)
    writer = PdfWriter()
    for p in reader.pages:
        p.trimbox = RectangleObject([BLEED, BLEED, BLEED + W, BLEED + H])
        p.bleedbox = RectangleObject([0, 0, W + 2 * BLEED, H + 2 * BLEED])
        writer.add_page(p)
    writer.add_metadata(reader.metadata)
    path = OUT / 'apexwings-business-card-print.pdf'
    with path.open('wb') as f:
        writer.write(f)
    return path


def crop_marks(c, x, y):
    c.setStrokeColor(HexColor('#718096'))
    c.setLineWidth(0.3)
    for tx in [x, x + W]:
        for ty, direction in [(y, -1), (y + H, 1)]:
            c.line(tx, ty + direction * 3.6*mm, tx, ty + direction * 5.6*mm)
    for ty in [y, y + H]:
        for tx, direction in [(x, -1), (x + W, 1)]:
            c.line(tx + direction * 3.6*mm, ty, tx + direction * 5.6*mm, ty)


def a4_pdf():
    path = OUT / 'apexwings-business-cards-A4.pdf'
    c = canvas.Canvas(str(path), pagesize=(210 * mm, 297 * mm), pageCompression=1)
    metadata(c, 'ApexWings business cards - A4 duplex - 8 per sheet')
    for side in ['front', 'back']:
        text(c, 'APEXWINGS / BUSINESS CARDS', 9, 285.2, 8, NAVY, True, 0.7)
        text(c, f'{side.upper()}  |  90 x 50 mm  |  8 cards per sheet', 9, 280.3, 7,
             HexColor('#526579'))
        for top in [22, 84, 146, 208]:
            for left in [6, 108]:
                x = (left + 3) * mm
                y = (297 - top - 53) * mm
                c.saveState()
                c.translate(x, y)
                draw_card(c, side)
                c.restoreState()
                crop_marks(c, x, y)
        text(c, 'PRINT AT 100% / ACTUAL SIZE. TURN OFF FIT TO PAGE.', 9, 17.5, 7.2, NAVY, True)
        text(c, 'Double-sided: flip on the long edge. Test one sheet to check alignment.',
             9, 12.7, 7, HexColor('#526579'))
        text(c, 'Cut at the crop marks. Use suitable card stock; finished size 90 x 50 mm.',
             9, 8.3, 7, HexColor('#526579'))
        c.showPage()
    c.save()
    return path


def preview_and_validate(press_path, sheet_path):
    doc = fitz.open(press_path)
    assert len(doc) == 2
    previews = []
    for i, p in enumerate(doc):
        # PyMuPDF rectangle coordinates start at the top, so inset equally.
        clip = fitz.Rect(BLEED, BLEED, BLEED + W, BLEED + H)
        pix = p.get_pixmap(matrix=fitz.Matrix(4, 4), clip=clip, alpha=False)
        pix.save(str(TMP / f'card-{i + 1}.png'))
        previews.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
    card_w, card_h = previews[0].size
    margin, gap, label_h = 70, 50, 45
    board = Image.new('RGB', (card_w + 2*margin, 2*card_h + 2*margin + gap + 2*label_h), '#e8edf3')
    d = ImageDraw.Draw(board)
    from PIL import ImageFont
    label_font = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 19)
    y = margin
    for label, im in zip(['FRONT', 'BACK'], previews):
        d.text((margin, y), label, fill='#526579', font=label_font)
        y += label_h
        board.paste(im, (margin, y))
        y += card_h + gap
    preview_path = OUT / 'apexwings-business-card-preview.png'
    board.save(preview_path)
    a4 = fitz.open(sheet_path)
    for i, p in enumerate(a4):
        p.get_pixmap(matrix=fitz.Matrix(1.3,1.3), alpha=False).save(str(TMP / f'a4-{i + 1}.png'))
    for path in [press_path, sheet_path]:
        reader = PdfReader(path)
        assert len(reader.pages) == 2
        assert PHONE in reader.pages[1].extract_text()
        assert 'Bulk haulage' in reader.pages[1].extract_text()
        if path == press_path:
            for p in reader.pages:
                assert abs(float(p.trimbox.width) / mm - 90) < .001
                assert abs(float(p.trimbox.height) / mm - 50) < .001
                assert abs(float(p.mediabox.width) / mm - 96) < .001
                assert abs(float(p.mediabox.height) / mm - 56) < .001
    result = {
        'card_size_mm': [90,50], 'bleed_mm': 3,
        'professional_pdf_pages': 2, 'a4_pdf_pages': 2, 'cards_per_a4': 8,
        'phone': PHONE, 'qr_target': WHATSAPP, 'qr_modules_including_quiet_zone': len(QR_MATRIX),
        'logo_dpi_at_print_size': round(Image.open(LOGO).width / (50/25.4)),
        'font_embedding': 'Segoe UI regular and bold, embedded TrueType subsets',
        'outputs': [str(p) for p in [press_path, sheet_path, preview_path]],
    }
    (TMP / 'validation.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    press = press_pdf()
    sheet = a4_pdf()
    preview_and_validate(press, sheet)
