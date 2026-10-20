"""Build a throwaway Obsidian vault for recording the README demo.

Usage: python tools/demo/make_demo_vault.py <vault-dir>

Writes a sample deck, a sample PDF (printed with Chrome) and a code file. Copies the built plugin from ./dist or LECTERN_OUT.
Neutral content on purpose: nothing from a real vault ends up in the GIF.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt

REPO = Path(__file__).resolve().parents[2]
INK = RGBColor(0x1F, 0x23, 0x2B)
AMBER = RGBColor(0xD9, 0x8E, 0x04)
MUTED = RGBColor(0x5B, 0x63, 0x70)


def slide_with_title(prs, title):
    s = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(0.12))
    bar.fill.solid()
    bar.fill.fore_color.rgb = AMBER
    bar.line.fill.background()
    box = s.shapes.add_textbox(Inches(0.7), Inches(0.5), Inches(11.9), Inches(1))
    p = box.text_frame.paragraphs[0]
    p.text = title
    p.font.size, p.font.bold, p.font.color.rgb = Pt(44), True, INK
    return s


def bullets(slide, lines, top=1.8):
    box = slide.shapes.add_textbox(Inches(0.9), Inches(top), Inches(11.5), Inches(4.5))
    tf = box.text_frame
    tf.word_wrap = True
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = "•  " + line
        p.font.size, p.font.color.rgb = Pt(30), INK
        p.space_after = Pt(14)


def make_deck(path):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = INK
    bg.line.fill.background()
    box = s.shapes.add_textbox(Inches(0.9), Inches(2.6), Inches(11.5), Inches(2))
    p = box.text_frame.paragraphs[0]
    p.text = "Network Security Fundamentals"
    p.font.size, p.font.bold, p.font.color.rgb = Pt(48), True, RGBColor(0xFF, 0xFF, 0xFF)
    p = box.text_frame.add_paragraph()
    p.text = "Lecture 3: the CIA triad"
    p.font.size, p.font.color.rgb = Pt(28), AMBER
    s.notes_slide.notes_text_frame.text = "Open with the breach headline from this week."

    s = slide_with_title(prs, "The CIA triad")
    bullets(s, [
        "Confidentiality: only the right people can read it",
        "Integrity: nobody changed it without you knowing",
        "Availability: it is there when you need it",
        "The triad is a way of asking questions, not a checklist",
    ])
    s.notes_slide.notes_text_frame.text = "Ask the room which one ransomware hits first."

    s = slide_with_title(prs, "Controls map to goals")
    bullets(s, [
        "Encryption at rest and in transit protects confidentiality",
        "Hashes and signatures detect tampering",
        "Backups and redundancy keep services up",
        "One control can serve more than one goal",
    ])
    s.notes_slide.notes_text_frame.text = "Midterm question comes from this slide."
    prs.save(path)


PDF_HTML = """<!doctype html><meta charset=utf-8>
<style>
 body{font:12pt/1.55 Georgia,serif;color:#1f232b;margin:0}
 .page{padding:0.9in 1in;page-break-after:always}
 h1{font:600 24pt/1.2 'Segoe UI',sans-serif;margin:0 0 4pt}
 h2{font:600 14pt 'Segoe UI',sans-serif;margin:20pt 0 6pt;color:#b37400}
 .sub{color:#5b6370;margin-bottom:22pt}
</style>
<div class=page>
<h1>Reading 3: Threat Modeling Basics</h1>
<div class=sub>Network Security Fundamentals, week 3</div>
<p>A threat model is a structured answer to four questions: what are we building,
what can go wrong, what are we going to do about it, and did we do a good job.
Teams that skip the first question tend to defend the wrong thing.</p>
<h2>Assets and attackers</h2>
<p>Start by listing assets: data, services and credentials that matter. Then list who
might want them. A student portal faces credential stuffing far more often than it
faces a nation-state, and the controls should reflect that.</p>
<p>Attackers follow the cheapest path. Phishing a help desk is usually cheaper than
breaking encryption, which is why most real incidents begin with a person, not a
cipher.</p>
<h2>STRIDE</h2>
<p>STRIDE groups threats into six kinds: spoofing, tampering, repudiation, information
disclosure, denial of service and elevation of privilege. Each one maps back to a
property in the CIA triad, plus authentication and non-repudiation.</p>
<p>Walk each data flow in the diagram and ask which of the six applies. The goal is
coverage, not a perfect list.</p>
</div>
<div class=page>
<h2>Ranking what you find</h2>
<p>Not every threat deserves a fix. Rank by likelihood and impact, fix the top of the
list, and write down why you accepted the rest. An accepted risk with a reason is a
decision. An accepted risk with no reason is an oversight.</p>
</div>
"""

CODE = '''"""Tiny port scanner for the lab. Only scan hosts you own."""
import socket


def scan(host: str, ports: range, timeout: float = 0.3) -> list[int]:
    open_ports = []
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            if s.connect_ex((host, port)) == 0:
                open_ports.append(port)
    return open_ports


if __name__ == "__main__":
    print(scan("127.0.0.1", range(20, 1025)))
'''


def find_build():
    for cand in [REPO / "dist", Path(os.environ.get("LECTERN_OUT", ""))]:
        if (cand / "main.js").exists():
            return cand
    env = REPO / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("LECTERN_OUT="):
                p = Path(line.split("=", 1)[1].strip())
                if (p / "main.js").exists():
                    return p
    sys.exit("No built plugin found. Run npm run build first.")


def main():
    vault = Path(sys.argv[1]).resolve()
    if vault.exists():
        shutil.rmtree(vault)
    (vault / "Week 3").mkdir(parents=True)
    make_deck(vault / "Week 3" / "Lecture 3 - CIA Triad.pptx")
    (vault / "Week 3" / "port_scan.py").write_text(CODE)
    html = vault / "_reading.html"
    html.write_text(PDF_HTML, encoding="utf-8")
    pdf = vault / "Week 3" / "Reading 3 - Threat Modeling.pdf"
    subprocess.run(["node", str(REPO / "tools" / "demo" / "print_pdf.mjs"), str(html), str(pdf)], check=True)
    html.unlink()

    obs = vault / ".obsidian"
    plug = obs / "plugins" / "lectern"
    plug.mkdir(parents=True)
    build = find_build()
    for f in ["main.js", "manifest.json", "styles.css"]:
        shutil.copy(build / f, plug / f)
    (obs / "community-plugins.json").write_text(json.dumps(["lectern"]))
    # Reading view, so the sidecar shows as a clean note in the last shot.
    (obs / "app.json").write_text(json.dumps({"defaultViewMode": "preview", "propertiesInDocument": "hidden"}))
    (obs / "appearance.json").write_text(json.dumps({"theme": "obsidian"}))
    print(vault)


if __name__ == "__main__":
    main()
