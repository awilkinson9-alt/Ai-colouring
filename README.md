# AI Coloring Magic 🎨

An interactive AI-powered coloring book application that generates coloring pages from text prompts and lets you color them with a variety of tools.

## Features

- 🎨 **AI-Generated Coloring Pages**: Generate coloring book illustrations from text prompts using Google's Imagen API
- 🖌️ **Multiple Tools**: 
  - Paint Bucket (Flood Fill)
  - Brush Tool
  - Pan/Zoom Tool
- 🎯 **Progress Tracking**: Visual progress meter showing completion percentage
- 💾 **Save & Print**: Export your artwork as PNG or print directly
- ↩️ **Undo Functionality**: Step back through your coloring history
- 📱 **Responsive Design**: Works on desktop and mobile devices

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up your Google API key:
   - Create a `.env` file in the root directory
   - Add your API key: `VITE_GOOGLE_API_KEY=your_api_key_here`

3. Run the development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Usage

1. Enter a text prompt describing what you want to color (e.g., "A happy dragon", "A cute cat")
2. Click the search button or press Enter to generate the coloring page
3. Select a color from the palette
4. Choose your tool (Brush, Fill, or Move)
5. Start coloring!
6. Use the undo button to step back through your changes
7. Save or print your masterpiece when done

## Technologies

- React 18
- Vite
- Tailwind CSS
- Lucide React (Icons)
- Google Imagen API

## Notes

- The app uses a fixed 800x800px canvas internally for optimal performance
- Progress tracking only counts pixels within the detected subject area
- The flood fill algorithm respects line boundaries to prevent coloring over outlines
