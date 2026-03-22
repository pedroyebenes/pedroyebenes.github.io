## RSVP Reader

An in-browser Rapid Serial Visual Presentation (RSVP) reader. Paste text or load EPUB books and read one word at a time with adjustable speed, smart pauses, and Optimal Recognition Point (ORP) highlighting for efficient, low-eye-movement reading.

### What is Rapid Serial Visual Presentation (RSVP)?

RSVP is a reading technique where words are shown sequentially at a fixed position, typically one word at a time. By keeping the text in one spot and highlighting the word’s Optimal Recognition Point (often around the first third of the word), RSVP minimizes saccades (eye movements) and reduces the need for line scanning. This can help some readers increase reading speed while maintaining comprehension. Smart timing adjustments (e.g., pausing slightly longer at punctuation or for long words) further improve rhythm and comfort.

### Features

- **Adjustable speed (WPM)**: Fine-grained control from slow to fast reading rates.
- **Smart pauses**: Extra timing after punctuation and for long words to preserve natural cadence.
- **ORP highlighting**: Emphasizes each word’s anchor character to speed recognition.
- **Short-word pairing**: Optionally pairs very short words (e.g., “of a”) to reduce choppiness.
- **Anchor guide**: Visual guide line for the ORP position to stabilize focus.
- **EPUB import**: Load EPUBs from a local file or a URL; navigate chapters easily.
- **Keyboard controls**: Space to play/pause; arrow keys to step forward/back; controls to rewind and reset.

### Getting Started

1. Open `index.html` in a modern desktop browser, or serve the folder with any static server.
2. Paste text into the editor, or use the EPUB import options:
   - **File**: Select a local EPUB file.
   - **URL**: Provide a direct link to an EPUB.
3. Set your preferred **WPM**, toggle **Smart Pauses**, **Short-word pairing**, and **Anchor guide**.
4. Press **Play** (or hit Space) to start. Use the navigation controls or arrow keys to move through words or chapters.

### Controls (high-level)

- **Space**: Play/Pause
- **Left/Right**: Step backward/forward a word (when paused)
- **Rewind/Reset**: Jump back or restart the session
- **Prev/Next Chapter**: Navigate chapters when an EPUB is loaded

### How it Works (brief)

- Text is tokenized into words with start/end offsets for precise navigation.
- Display timing derives from the configured WPM, plus:
  - Extra pause after sentence-ending punctuation and commas/semicolons/colons/em-dash.
  - Additional delay for long words to aid recognition.
- ORP (Optimal Recognition Point) is computed by word length buckets to place the visual anchor.

### Notes

- Best experienced on desktop with a clear, distraction-free viewport.
- Reading speed and comfort vary by person; adjust WPM and toggles to taste.

