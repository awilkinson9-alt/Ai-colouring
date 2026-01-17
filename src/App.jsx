import React, { useState, useRef, useEffect } from 'react';
import { 
  Palette, 
  Download, 
  RotateCcw, 
  Image as ImageIcon, 
  Search, 
  Loader2, 
  PaintBucket, 
  Brush,
  ZoomIn,
  Move,
  Printer
} from 'lucide-react';

// Updated palette with Brown (#8B4513) and more variety
const COLORS = [
  '#FF595E', '#FF924C', '#FFCA3A', '#C5CA30', '#8AC926', '#36949D', 
  '#1982C4', '#4267AC', '#565EBB', '#6A4C93', '#8B4513', '#A52A2A',
  '#FF99C8', '#FCF6BD', '#D0F4DE', '#A9DEF9', '#E4C1F9', '#D2B48C',
  '#FFFFFF', '#F5F5F5', '#BDBDBD', '#757575', '#424242', '#000000'
];


const App = () => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#FF595E');
  const [tool, setTool] = useState('bucket'); 
  const [brushSize, setBrushSize] = useState(20);
  const [history, setHistory] = useState([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState(null);
  
  const [progress, setProgress] = useState(0);
  const totalFillablePixels = useRef(0);
  const subjectMask = useRef(null); 

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  
  const drawCanvasRef = useRef(null);
  const linesCanvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const isInteractingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || ""; 

  useEffect(() => {
    const updateCanvasSize = () => {
      if (containerRef.current && drawCanvasRef.current && linesCanvasRef.current) {
        const internalSize = 800; 
        
        [drawCanvasRef.current, linesCanvasRef.current].forEach(canvas => {
          if (canvas.width === internalSize) return;

          const temp = document.createElement('canvas');
          temp.width = canvas.width;
          temp.height = canvas.height;
          if (canvas.width > 0) temp.getContext('2d').drawImage(canvas, 0, 0);
          
          canvas.width = internalSize;
          canvas.height = internalSize;
          
          const ctx = canvas.getContext('2d');
          if (canvas === drawCanvasRef.current && !imageLoaded) {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, internalSize, internalSize);
          }
          if (temp.width > 0) ctx.drawImage(temp, 0, 0, internalSize, internalSize);
        });
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [imageLoaded]);

  const generateImage = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    setImageLoaded(false);
    setProgress(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });

    const fullPrompt = `simple black and white coloring book illustration for kids, thick bold black outlines, pure white background, no shading, no gradients, clean vector style, high contrast, outline only, no filled areas: ${prompt}`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: fullPrompt }],
          parameters: { sampleCount: 1 }
        })
      });

      if (!response.ok) throw new Error('Failed to generate');
      const result = await response.json();
      const base64Image = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
      processImage(base64Image);
    } catch (err) {
      setError("AI is busy! Try again in a second.");
      setIsGenerating(false);
    }
  };

  const processImage = (src) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = 800;
      const dCtx = drawCanvasRef.current.getContext('2d');
      const lCtx = linesCanvasRef.current.getContext('2d');

      dCtx.fillStyle = 'white';
      dCtx.fillRect(0, 0, size, size);
      lCtx.clearRect(0, 0, size, size);

      const temp = document.createElement('canvas');
      temp.width = size;
      temp.height = size;
      const tCtx = temp.getContext('2d');
      const scale = Math.min(size / img.width, size / img.height);
      const x = (size / 2) - (img.width / 2) * scale;
      const y = (size / 2) - (img.height / 2) * scale;
      tCtx.drawImage(img, x, y, img.width * scale, img.height * scale);

      const imgData = tCtx.getImageData(0, 0, size, size);
      const lineData = lCtx.createImageData(size, size);
      const backgroundDetection = new Uint8Array(size * size); 
      
      for (let i = 0; i < imgData.data.length; i += 4) {
        const brightness = (imgData.data[i] + imgData.data[i + 1] + imgData.data[i + 2]) / 3;
        const idx = i / 4;
        if (brightness < 200) { 
          lineData.data[i] = 0; lineData.data[i + 1] = 0; lineData.data[i + 2] = 0; 
          lineData.data[i + 3] = 255 - brightness; 
          backgroundDetection[idx] = 2; 
        } else {
          lineData.data[i + 3] = 0; 
          backgroundDetection[idx] = 0; 
        }
      }
      lCtx.putImageData(lineData, 0, 0);

      const queue = [];
      const visited = new Uint8Array(size * size);
      const corners = [0, size - 1, (size * size) - size, (size * size) - 1];
      
      corners.forEach(startIdx => {
        if (backgroundDetection[startIdx] === 0) {
          queue.push(startIdx);
          visited[startIdx] = 1;
        }
      });

      while (queue.length > 0) {
        const curr = queue.shift();
        const cx = curr % size;
        const cy = Math.floor(curr / size);

        const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];

        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
            const nIdx = ny * size + nx;
            if (!visited[nIdx] && backgroundDetection[nIdx] === 0) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      subjectMask.current = new Uint8Array(size * size);
      let fillableCount = 0;
      for (let i = 0; i < size * size; i++) {
        if (backgroundDetection[i] === 0 && visited[i] === 0) {
          subjectMask.current[i] = 1;
          fillableCount++;
        }
      }

      if (fillableCount === 0) {
        for (let i = 0; i < size * size; i++) {
          if (backgroundDetection[i] === 0) {
            subjectMask.current[i] = 1;
            fillableCount++;
          }
        }
      }
      
      totalFillablePixels.current = fillableCount;
      saveToHistory();
      setImageLoaded(true);
      setIsGenerating(false);
    };
    img.src = src;
  };

  const calculateProgress = () => {
    if (!totalFillablePixels.current || !subjectMask.current) return;
    const ctx = drawCanvasRef.current.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 800, 800);
    let coloredInSubjectCount = 0;
    
    for (let i = 0; i < imgData.data.length; i += 4) {
      const idx = i / 4;
      if (subjectMask.current[idx] === 1) {
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        if (r < 255 || g < 255 || b < 255) {
          coloredInSubjectCount++;
        }
      }
    }
    
    const percentage = Math.min(100, Math.round((coloredInSubjectCount / totalFillablePixels.current) * 100));
    setProgress(percentage);
  };

  const saveToHistory = () => {
    const ctx = drawCanvasRef.current.getContext('2d');
    setHistory(prev => [...prev.slice(-19), ctx.getImageData(0, 0, 800, 800)]);
    calculateProgress();
  };

  const getCanvasCoords = (e) => {
    const rect = linesCanvasRef.current.getBoundingClientRect();
    const visualX = e.clientX - rect.left;
    const visualY = e.clientY - rect.top;
    let x = (visualX / rect.width) * 800;
    let y = (visualY / rect.height) * 800;
    x = Math.max(0, Math.min(799, x));
    y = Math.max(0, Math.min(799, y));
    return { x, y };
  };

  const startInteraction = (e) => {
    if (!imageLoaded) return;
    const coords = getCanvasCoords(e);
    isInteractingRef.current = true;
    lastPointRef.current = { ...coords, rawX: e.clientX, rawY: e.clientY };

    if (tool === 'bucket') {
      performFloodFill(Math.floor(coords.x), Math.floor(coords.y));
    } else if (tool === 'brush') {
      draw(coords.x, coords.y);
    }
  };

  const handlePointerMove = (e) => {
    if (!isInteractingRef.current) return;
    if (tool === 'hand') {
      const dx = e.clientX - lastPointRef.current.rawX;
      const dy = e.clientY - lastPointRef.current.rawY;
      setPan(prev => ({ x: prev.x + dx / zoom, y: prev.y + dy / zoom }));
      lastPointRef.current = { ...lastPointRef.current, rawX: e.clientX, rawY: e.clientY };
    } else if (tool === 'brush') {
      const coords = getCanvasCoords(e);
      draw(coords.x, coords.y);
    }
  };

  const stopInteraction = () => {
    if (isInteractingRef.current) {
      isInteractingRef.current = false;
      saveToHistory();
    }
  };

  const draw = (x, y) => {
    const ctx = drawCanvasRef.current.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPointRef.current = { ...lastPointRef.current, x, y };
  };

  const performFloodFill = (startX, startY) => {
    const drawCtx = drawCanvasRef.current.getContext('2d');
    const lineCtx = linesCanvasRef.current.getContext('2d');
    const width = 800;
    const height = 800;

    const drawData = drawCtx.getImageData(0, 0, width, height);
    const lineData = lineCtx.getImageData(0, 0, width, height);
    
    const targetColor = getPixel(drawData, startX, startY);
    const fillColor = hexToRgb(selectedColor);

    if (!targetColor || !fillColor) return;
    if (colorsMatch(targetColor, [fillColor.r, fillColor.g, fillColor.b, 255])) return;

    const startLineColor = getPixel(lineData, startX, startY);
    if (startLineColor[3] > 150) return; 

    const pixelsToCheck = [startX, startY];
    while (pixelsToCheck.length > 0) {
      const y = pixelsToCheck.pop();
      const x = pixelsToCheck.pop();

      const currentDrawColor = getPixel(drawData, x, y);
      const currentLineColor = getPixel(lineData, x, y);

      if (currentDrawColor && colorsMatch(targetColor, currentDrawColor) && currentLineColor[3] < 150) {
        const index = (y * width + x) * 4;
        drawData.data[index] = fillColor.r;
        drawData.data[index + 1] = fillColor.g;
        drawData.data[index + 2] = fillColor.b;
        drawData.data[index + 3] = 255;

        if (x > 0) pixelsToCheck.push(x - 1, y);
        if (x < width - 1) pixelsToCheck.push(x + 1, y);
        if (y > 0) pixelsToCheck.push(x, y - 1);
        if (y < height - 1) pixelsToCheck.push(x, y + 1);
      }
    }
    drawCtx.putImageData(drawData, 0, 0);
    saveToHistory();
  };

  const getPixel = (p, x, y) => {
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return null;
    const i = (y * p.width + x) * 4;
    return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
  };

  const colorsMatch = (c1, c2, t = 45) => 
    Math.abs(c1[0] - c2[0]) <= t && Math.abs(c1[1] - c2[1]) <= t && Math.abs(c1[2] - c2[2]) <= t;

  const hexToRgb = (hex) => {
    const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return res ? { r: parseInt(res[1], 16), g: parseInt(res[2], 16), b: parseInt(res[3], 16) } : null;
  };

  const undo = () => {
    if (history.length <= 1) return;
    const newHistory = [...history];
    newHistory.pop();
    const prevState = newHistory[newHistory.length - 1];
    drawCanvasRef.current.getContext('2d').putImageData(prevState, 0, 0);
    setHistory(newHistory);
    calculateProgress();
  };

  const getProgressIcon = () => {
    if (progress === 100) return '🏆';
    if (progress > 80) return '🤩';
    if (progress > 50) return '🎨';
    if (progress > 20) return '✍️';
    return '🌱';
  };

  const handleSave = () => {
    const final = document.createElement('canvas');
    final.width = 800; final.height = 800;
    const fCtx = final.getContext('2d');
    fCtx.drawImage(drawCanvasRef.current, 0, 0); 
    fCtx.drawImage(linesCanvasRef.current, 0, 0);
    const link = document.createElement('a'); 
    link.download = 'my-art.png'; 
    link.href = final.toDataURL(); 
    link.click();
  };

  const handlePrint = () => {
    const final = document.createElement('canvas');
    final.width = 800; final.height = 800;
    const fCtx = final.getContext('2d');
    fCtx.drawImage(drawCanvasRef.current, 0, 0); 
    fCtx.drawImage(linesCanvasRef.current, 0, 0);
    const dataUrl = final.toDataURL();

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    // Using display block and max-width ensures the image fits the print page correctly
    doc.write(`
      <html>
        <body style="margin:0;display:flex;justify-content:center;align-items:center;">
          <img src="${dataUrl}" style="max-width:100%; height:auto;" onload="window.print();">
        </body>
      </html>
    `);
    doc.close();

    // Clean up iframe after printing
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-amber-50 font-sans text-slate-800 p-4 md:p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-black text-orange-500 flex items-center justify-center gap-3 drop-shadow-sm uppercase tracking-tighter">
          <Palette className="w-10 h-10" /> AI Coloring Magic
        </h1>
      </div>

      <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-4 order-2 lg:order-1">
          <div className="bg-white p-5 rounded-3xl shadow-lg border-4 border-white">
            <div className="flex gap-2">
              <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A happy dragon..." className="flex-1 bg-slate-100 border-none rounded-2xl px-4 py-3 outline-none transition-all font-medium" onKeyDown={(e) => e.key === 'Enter' && generateImage()}/>
              <button onClick={generateImage} disabled={isGenerating || !prompt.trim()} className="p-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 text-white rounded-2xl shadow-md active:scale-95 transition-transform">
                {isGenerating ? <Loader2 className="animate-spin" /> : <Search />}
              </button>
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl shadow-lg border-4 border-white">
            <h2 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-widest flex items-center gap-2"><ZoomIn size={14}/> Zoom Tool</h2>
            <div className="flex items-center gap-4">
              <input type="range" min="1" max="4" step="0.1" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="flex-1 accent-orange-500"/>
              <button onClick={() => { setZoom(1); setPan({x:0, y:0}); }} className="text-xs font-bold text-orange-500 bg-orange-50 px-3 py-2 rounded-xl border border-orange-200">Reset</button>
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl shadow-lg border-4 border-white">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <button onClick={() => setTool('brush')} className={`flex flex-col items-center justify-center gap-1 p-3 rounded-2xl font-bold border-b-4 transition-all ${tool === 'brush' ? 'bg-orange-500 text-white border-orange-700 -translate-y-1' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}><Brush size={20}/> <span className="text-[10px]">Brush</span></button>
              <button onClick={() => setTool('bucket')} className={`flex flex-col items-center justify-center gap-1 p-3 rounded-2xl font-bold border-b-4 transition-all ${tool === 'bucket' ? 'bg-blue-500 text-white border-blue-700 -translate-y-1' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}><PaintBucket size={20}/> <span className="text-[10px]">Fill</span></button>
              <button onClick={() => setTool('hand')} className={`flex flex-col items-center justify-center gap-1 p-3 rounded-2xl font-bold border-b-4 transition-all ${tool === 'hand' ? 'bg-purple-500 text-white border-purple-700 -translate-y-1' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}><Move size={20}/> <span className="text-[10px]">Move</span></button>
            </div>
            {tool === 'brush' && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <label className="text-xs font-bold text-slate-400 mb-2 block uppercase tracking-widest">Brush Size</label>
                <input 
                  type="range" 
                  min="5" 
                  max="40" 
                  step="5" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))} 
                  className="w-full accent-orange-500"
                />
                <div className="text-xs text-slate-500 text-center mt-1">{brushSize}px</div>
              </div>
            )}
          </div>

          <div className="bg-white p-5 rounded-3xl shadow-lg border-4 border-white grid grid-cols-6 gap-2">
            {COLORS.map((color) => (
              <button key={color} onClick={() => setSelectedColor(color)} className={`w-full aspect-square rounded-full border-4 transition-all ${selectedColor === color ? 'border-slate-800 scale-110 shadow-md rotate-6' : 'border-transparent hover:scale-110'}`} style={{ backgroundColor: color }} />
            ))}
          </div>

          {/* Sidebar Actions */}
          <div className="bg-white p-4 rounded-3xl shadow-lg border-4 border-white flex gap-2">
             <button 
                onClick={handleSave} 
                disabled={!imageLoaded} 
                className="flex-1 bg-green-500 hover:bg-green-600 p-4 rounded-2xl shadow-md font-bold text-white border-b-4 border-green-700 active:translate-y-1 active:border-b-0 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Download size={20} /> Save
              </button>
              <button 
                onClick={handlePrint} 
                disabled={!imageLoaded} 
                className="flex-1 bg-blue-500 hover:bg-blue-600 p-4 rounded-2xl shadow-md font-bold text-white border-b-4 border-blue-700 active:translate-y-1 active:border-b-0 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Printer size={20} /> Print
              </button>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4 order-1 lg:order-2">
          {/* Progress Bar */}
          <div className="bg-white p-4 rounded-3xl shadow-xl border-4 border-white">
            <div className="flex items-center justify-between mb-2 px-2">
              <span className="text-sm font-black text-slate-500 uppercase tracking-widest">Masterpiece Meter</span>
              <span className="text-xl font-bold flex items-center gap-1">
                {getProgressIcon()} {progress}%
              </span>
            </div>
            <div className="h-6 bg-slate-100 rounded-full overflow-hidden border-2 border-slate-100">
              <div 
                className="h-full bg-gradient-to-r from-yellow-400 via-orange-500 to-pink-500 transition-all duration-500 ease-out flex items-center justify-end px-2"
                style={{ width: `${progress}%` }}
              >
                {progress > 10 && <div className="w-2 h-2 bg-white/50 rounded-full animate-pulse" />}
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm font-medium">
              {error}
            </div>
          )}

          <div ref={containerRef} className="relative bg-white p-2 rounded-[40px] shadow-2xl border-8 border-white ring-4 ring-orange-100 w-full max-w-[600px] aspect-square overflow-hidden cursor-crosshair">
            {isGenerating && (
              <div className="absolute inset-0 z-30 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" />
                <h3 className="text-2xl font-black text-slate-700">Magical Art in Progress...</h3>
              </div>
            )}
            <div style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: 'center center', transition: isInteractingRef.current ? 'none' : 'transform 0.1s ease-out' }} className="absolute inset-0 w-full h-full">
              <canvas ref={drawCanvasRef} className="absolute inset-0 w-full h-full bg-white pointer-events-none" />
              <canvas ref={linesCanvasRef} onPointerDown={startInteraction} onPointerMove={handlePointerMove} onPointerUp={stopInteraction} onPointerLeave={stopInteraction} className="absolute inset-0 w-full h-full touch-none" />
            </div>
            {!imageLoaded && !isGenerating && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-slate-300 pointer-events-none">
                <ImageIcon size={64} className="mb-4 opacity-50" />
                <p className="font-black text-xl">Type a prompt to start!</p>
              </div>
            )}

            {/* Corner Undo Button */}
            {imageLoaded && (
              <div className="absolute top-4 right-4 z-40">
                <button 
                  onClick={undo} 
                  disabled={history.length <= 1} 
                  className="bg-white/80 hover:bg-white p-3 rounded-full shadow-lg text-slate-600 hover:text-orange-500 border-2 border-white/50 transition-all active:scale-90 disabled:opacity-0 disabled:pointer-events-none"
                  title="Undo"
                >
                  <RotateCcw size={24} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
