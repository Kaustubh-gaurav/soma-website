# SOMA website

One page slideshow site for SOMA: real surgical video, audio and context, labeled for AI.

Static HTML, CSS and JS, no build step. Hosted on GitHub Pages from `main`.

- `index.html` holds every scene
- `css/style.css` holds the layout, drawn from the 1280 x 832 Figma frames
- `js/main.js` runs the slideshow: auto advance, wheel, keys, swipe, the section rail and the form
- `assets/` holds the clips, posters, Satoshi and the backer logos

Review helpers: `?still` stops the auto advance, `?s=3` opens on scene 3.

The request form needs an endpoint: set `FORM_ENDPOINT` at the top of `js/main.js`.
