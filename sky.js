// ==============================================================
//  Shared pixel sky decor. Both pages draw the same stars and
//  clouds; this is the one copy of it.
// ==============================================================

export function buildSky() {
  const stars = document.getElementById("stars");
  if (stars) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 90; i++) {
      const s = document.createElement("i");
      s.className = "star" + (Math.random() < 0.18 ? " star--big" : "");
      s.style.left = `${Math.random() * 100}%`;
      // keep stars in the darker upper band of the sky
      s.style.top = `${Math.random() * 62}%`;
      s.style.animationDelay = `${Math.random() * 3.2}s`;
      s.style.opacity = String(0.35 + Math.random() * 0.55);
      frag.appendChild(s);
    }
    stars.appendChild(frag);
  }

  const clouds = document.getElementById("clouds");
  if (clouds) {
    for (let i = 0; i < 6; i++) {
      const c = document.createElement("div");
      c.className = "cloud";
      const w = 40 + Math.random() * 46;
      c.style.width = `${w}px`;
      c.style.height = `${Math.round(w / 3.4)}px`;
      c.style.top = `${12 + Math.random() * 58}%`;
      c.style.animationDuration = `${58 + Math.random() * 70}s`;
      c.style.animationDelay = `${-Math.random() * 90}s`;
      c.style.opacity = String(0.45 + Math.random() * 0.5);
      clouds.appendChild(c);
    }
  }
}
