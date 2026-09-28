# SOMA website (V2)

Real-world surgical data for AI. Built from the final screens on Figma "Page 8".

Static HTML, CSS and JS, no build step. Hosted on GitHub Pages from `main`.

- `index.html` holds every section, drawn on a 1280 x 832 board
- `css/style.css` holds the tokens, type ramp, the scaled board, the animated frame and the phone layout
- `js/main.js` fits the board to the window, moves between sections (wheel, keys, swipe, rail),
  animates the frame geometry per section, and runs the specimen layers, the Hear transcript,
  the Understand steps, the delivery file browser and the form
- `assets/` holds the clips, posters, Satoshi, the backer logos and the hospital illustration

Review helpers: `?s=3` opens on section 3, `?noload` skips the loader, `?still` turns transitions off.

The request form needs an endpoint: set `FORM_ENDPOINT` at the top of `js/main.js`.
