# Tattoo library

The left rail contains starter artwork and a browser-local PNG collection. Search matches design names and categories. Selecting a design uses the existing single-tattoo placement flow; it replaces the current artwork rather than adding another layer. Figure and Studio remain compact shortcuts. PNG imports from either side of the editor are retained in IndexedDB and deduplicated. Removal affects the collection, not the tattoo saved in a scene. Uploads are local to this browser, not account-synced.

Starter assets: `public/tattoos/botanical-rose.png`, `public/tattoos/lunar-moth.png`, and `public/tattoos/ornamental-dagger.png`. All three use PNG transparency. Selecting artwork projects it onto visible skin when there is no existing placement; replacing a design preserves its placement.
