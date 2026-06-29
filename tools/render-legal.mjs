// Genera le pagine HTML stilate dei documenti legali a partire dai .md versionati.
// Eseguire dopo ogni modifica ai .md (o quando si riempiono i placeholder):
//   node tools/render-legal.mjs
// Output: legal/<nome>.html (URL puliti, serviti al posto del markdown grezzo).
// Design allineato a informazioni.html (avorio/terracotta, Cormorant + Hanken).

import { marked } from "marked";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEGAL = join(ROOT, "legal");

const DOCS = [
  { src: "allergeni.v2026-06-26.md", out: "allergeni.html", eyebrow: "Informazioni alimentari" },
  { src: "privacy-policy.v2026-06-26.md", out: "privacy-policy.html", eyebrow: "Protezione dati" },
  { src: "condizioni-generali-vendita.v2026-06-26.md", out: "condizioni-generali-vendita.html", eyebrow: "Vendita a distanza" },
];

marked.setOptions({ gfm: true, breaks: false });

const CSS = `
  :root{
    --cream:#fffdf8; --paper:oklch(0.993 0.006 84); --paper-2:oklch(0.960 0.013 82);
    --ink:oklch(0.265 0.014 58); --ink-2:oklch(0.405 0.014 60); --muted:oklch(0.545 0.013 62);
    --line:oklch(0.902 0.012 78); --line-2:oklch(0.845 0.015 76);
    --accent:oklch(0.560 0.105 42); --accent-ink:oklch(0.470 0.100 42); --accent-soft:oklch(0.932 0.034 50);
    --blue:#63819f; --green:#537f68;
    --serif:"Cormorant Garamond", Georgia, "Times New Roman", serif;
    --sans:"Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, sans-serif;
    --shadow-card:0 1px 2px rgba(60,40,30,.04), 0 14px 34px -20px rgba(70,45,30,.28);
    --shadow-screen:0 2px 6px rgba(60,40,30,.05), 0 40px 80px -42px rgba(60,40,30,.42);
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; }
  body{ background:var(--paper); font-family:var(--sans); color:var(--ink); -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
  a{ color:var(--accent-ink); }
  .page{ max-width:820px; margin:0 auto; min-height:100dvh; background:var(--cream); box-shadow:var(--shadow-screen); }
  .top{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 26px; border-bottom:1px solid var(--line); position:sticky; top:0; background:rgba(255,253,248,.92); backdrop-filter:saturate(1.1) blur(6px); z-index:5; }
  .brand{ display:flex; align-items:center; gap:12px; text-decoration:none; min-width:0; }
  .brand img{ width:52px; height:auto; display:block; background:rgba(255,255,255,.7); border:1px solid rgba(168,85,47,.25); border-radius:11px; padding:6px; }
  .brand span{ font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }
  .back{ text-decoration:none; color:var(--accent-ink); font-size:13px; font-weight:700; white-space:nowrap; }
  .hero{ padding:46px 30px 26px; border-bottom:1px solid var(--line); background:linear-gradient(180deg, var(--paper), var(--cream)); }
  .eyebrow{ font-size:11px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--accent-ink); margin:0 0 12px; }
  .hero h1{ font-family:var(--serif); font-size:40px; line-height:1.02; font-weight:600; margin:0; letter-spacing:0; color:var(--ink); }
  .content{ padding:30px 30px 50px; }
  .sheet{ max-width:680px; margin:0 auto; }
  .sheet h2{ font-family:var(--serif); font-size:27px; line-height:1.12; font-weight:600; margin:34px 0 12px; color:var(--ink); }
  .sheet h3{ font-size:12.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--accent-ink); margin:26px 0 10px; font-weight:700; }
  .sheet h4{ font-size:15px; font-weight:700; margin:18px 0 8px; color:var(--ink); }
  .sheet p{ font-size:15px; line-height:1.7; color:var(--ink-2); margin:0 0 14px; }
  .sheet ul,.sheet ol{ margin:0 0 16px; padding-left:22px; color:var(--ink-2); }
  .sheet li{ font-size:14.5px; line-height:1.6; margin:6px 0; }
  .sheet strong{ color:var(--ink); font-weight:700; }
  .sheet a{ color:var(--accent-ink); }
  .sheet blockquote{ border-left:4px solid var(--green); background:color-mix(in oklch, var(--paper) 82%, #e5f1e8); padding:12px 16px; margin:18px 0; border-radius:0 8px 8px 0; }
  .sheet blockquote p{ margin:0; font-size:14px; }
  .sheet table{ width:100%; border-collapse:collapse; margin:16px 0; font-size:13.5px; }
  .sheet th,.sheet td{ border:1px solid var(--line-2); padding:9px 11px; text-align:left; vertical-align:top; line-height:1.5; color:var(--ink-2); }
  .sheet th{ background:var(--paper-2); color:var(--ink); font-weight:700; }
  .sheet hr{ border:0; border-top:1px solid var(--line); margin:30px 0; }
  .sheet code{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; background:var(--paper-2); padding:1px 5px; border-radius:5px; }
  .footer{ padding:24px 30px 34px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; line-height:1.6; }
  .footer a{ color:var(--muted); }
  .top:focus-within, .back:focus-visible, .brand:focus-visible{ outline:2px solid var(--blue); outline-offset:3px; }
  @media (max-width:680px){
    .top{ padding:14px 18px; }
    .hero{ padding:34px 20px 22px; }
    .hero h1{ font-size:31px; }
    .content{ padding:24px 20px 40px; }
    .sheet table{ font-size:12.5px; }
  }
  @media (prefers-reduced-motion:reduce){ *{ transition:none !important; } }
`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap({ title, eyebrow, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="it" data-accent="terracotta">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} — Gelateria BM&amp;V</title>
  <meta name="description" content="${esc(title)} — Gelateria BM&amp;V, Monte Petrosu (San Teodoro).">
  <link rel="icon" type="image/png" href="/img/favicon.png">
  <link rel="apple-touch-icon" href="/img/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
  <main class="page">
    <header class="top">
      <a class="brand" href="/index.html" aria-label="Torna alla home">
        <img src="/img/logo-full.png" alt="Gelateria BM&amp;V">
        <span>Monte Petrosu</span>
      </a>
      <a class="back" href="/informazioni.html">← Informazioni</a>
    </header>
    <section class="hero">
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h1>${esc(title)}</h1>
    </section>
    <section class="content"><article class="sheet">${bodyHtml}</article></section>
    <footer class="footer">
      La versione italiana di questo documento fa fede. ·
      <a href="/informazioni.html">Informazioni clienti</a> ·
      <a href="/index.html">Home</a>
    </footer>
  </main>
</body>
</html>
`;
}

// Estrae il primo "# Titolo" come titolo pagina e lo rimuove dal corpo.
function splitTitle(md) {
  const lines = md.split("\n");
  let title = "";
  for (let i = 0; i < lines.length; i++) {
    const m = /^#\s+(.+?)\s*$/.exec(lines[i]);
    if (m) { title = m[1].replace(/\s*—\s*Gelateria BM&V\s*$/i, "").trim(); lines.splice(i, 1); break; }
  }
  return { title, body: lines.join("\n") };
}

let count = 0;
for (const d of DOCS) {
  const md = readFileSync(join(LEGAL, d.src), "utf8");
  const { title, body } = splitTitle(md);
  const bodyHtml = marked.parse(body);
  writeFileSync(join(LEGAL, d.out), wrap({ title: title || d.eyebrow, eyebrow: d.eyebrow, bodyHtml }));
  console.log(`✓ ${d.out}  ←  ${d.src}  (${title})`);
  count++;
}
console.log(`\n${count} documenti renderizzati in legal/`);
