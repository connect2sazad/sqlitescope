/* SQLiteScope site interactions */

// ---- Live theme-switching demo (hero) -------------------------------
// Mirrors a handful of the app's real installed themes so visitors can
// see the "twelve installed themes" feature in action before downloading.
const THEMES = [
  { id: "classic",  name: "Classic Beauty", bg: "#1b1a3d", panel: "#211f49", accent: "#6f66ff" },
  { id: "xp",        name: "Windows XP",     bg: "#245ecb", panel: "#3a75e0", accent: "#ffb400" },
  { id: "neon",      name: "Cyber Neon",     bg: "#0d0221", panel: "#170a33", accent: "#ff2fd0" },
  { id: "dracula",   name: "Dracula Plum",   bg: "#241b30", panel: "#2f2340", accent: "#bd93f9" },
  { id: "forest",    name: "Forest Terminal",bg: "#0f1f16", panel: "#152a1d", accent: "#4fd97f" },
  { id: "ocean",     name: "Ocean Glass",    bg: "#0b2438", panel: "#123350", accent: "#4fc3f7" },
  { id: "rose",      name: "Rose Quartz",    bg: "#2c1720", panel: "#3a1f2b", accent: "#ff9ab0" },
  { id: "amber",     name: "Retro Amber",    bg: "#1a1305", panel: "#241b08", accent: "#ffb020" },
];

function initThemeDemo() {
  const demo = document.querySelector("[data-demo]");
  if (!demo) return;
  const switchRow = demo.querySelector("[data-swatches]");
  const caption = demo.querySelector("[data-demo-caption]");
  if (!switchRow) return;

  function applyTheme(theme) {
    demo.style.setProperty("--demo-bg", theme.bg);
    demo.style.setProperty("--demo-panel", theme.panel);
    demo.style.setProperty("--demo-accent", theme.accent);
    if (caption) caption.innerHTML = `Previewing <strong>${theme.name}</strong> — one of twelve installed themes`;
    switchRow.querySelectorAll(".swatch").forEach((s) => {
      s.classList.toggle("selected", s.dataset.themeId === theme.id);
    });
  }

  THEMES.forEach((theme, i) => {
    const btn = document.createElement("button");
    btn.className = "swatch" + (i === 0 ? " selected" : "");
    btn.type = "button";
    btn.style.background = theme.bg;
    btn.dataset.themeId = theme.id;
    btn.setAttribute("aria-label", "Preview " + theme.name + " theme");
    btn.addEventListener("click", () => applyTheme(theme));
    switchRow.appendChild(btn);
  });

  applyTheme(THEMES[0]);

  // Gentle auto-cycle until the visitor interacts, so the feature reads
  // as alive rather than a static screenshot.
  let idx = 0;
  let auto = setInterval(() => {
    idx = (idx + 1) % THEMES.length;
    applyTheme(THEMES[idx]);
  }, 3200);
  switchRow.addEventListener("click", () => clearInterval(auto), { once: true });
}

// ---- Mobile nav toggle -------------------------------------------------
function initNavToggle() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const links = document.querySelector(".nav-links");
  if (!toggle || !links) return;
  toggle.addEventListener("click", () => {
    const open = links.style.display === "flex";
    links.style.display = open ? "none" : "flex";
  });
}

// ---- Docs scroll-spy -----------------------------------------------------
function initDocsScrollSpy() {
  const navLinks = document.querySelectorAll(".docs-nav a");
  if (!navLinks.length) return;
  const targets = Array.from(navLinks)
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => a.classList.remove("active"));
        const match = document.querySelector(`.docs-nav a[href="#${entry.target.id}"]`);
        if (match) match.classList.add("active");
      });
    },
    { rootMargin: "-20% 0px -70% 0px" }
  );
  targets.forEach((t) => observer.observe(t));
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeDemo();
  initNavToggle();
  initDocsScrollSpy();
});
