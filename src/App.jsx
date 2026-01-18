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
  const lastRequestTime = useRef(0);
  const [isCached, setIsCached] = useState(false); 

  useEffect(() => {
    const updateCanvasSize = () => {
      if (containerRef.current && drawCanvasRef.current && linesCanvasRef.current) {
        // Use 1024 if image is loaded (matches original image size), otherwise 800
        const internalSize = imageLoaded ? 1024 : 800; 
        
        [drawCanvasRef.current, linesCanvasRef.current].forEach(canvas => {
          // Skip resize if canvas is already correct size - prevents blur from re-scaling processed images
          if (canvas.width === internalSize && canvas.height === internalSize) {
            // Just ensure smoothing is disabled
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            return;
          }

          const temp = document.createElement('canvas');
          temp.width = canvas.width;
          temp.height = canvas.height;
          if (canvas.width > 0 && canvas.height > 0) {
            const tempCtx = temp.getContext('2d');
            tempCtx.imageSmoothingEnabled = false;
            tempCtx.drawImage(canvas, 0, 0);
          }
          
          canvas.width = internalSize;
          canvas.height = internalSize;
          
          const ctx = canvas.getContext('2d');
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:67',message:'Canvas resize effect',data:{canvasName:canvas===drawCanvasRef.current?'draw':'lines',imageLoaded,oldWidth:temp.width,newWidth:internalSize},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
          // #endregion
          // CRITICAL: Keep smoothing DISABLED for sharp lines (only enable for zoom if needed)
          // For coloring book style, we want crisp lines, not smooth/blurry ones
          ctx.imageSmoothingEnabled = false;
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:72',message:'After setting smoothing in resize',data:{smoothingEnabled:ctx.imageSmoothingEnabled},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
          // #endregion
          if (canvas === drawCanvasRef.current && !imageLoaded) {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, internalSize, internalSize);
          }
          // Only re-draw if there was existing content (avoid scaling empty canvas)
          if (temp.width > 0 && temp.height > 0) {
            ctx.drawImage(temp, 0, 0, internalSize, internalSize);
          }
        });
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [imageLoaded]);

  // Simple hash function for caching
  const hashPrompt = (text) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  };

  // Check cache before generating
  const getCachedImage = (promptKey) => {
    try {
      const cached = localStorage.getItem(`coloring_cache_${promptKey}`);
      if (cached) {
        const { image, timestamp } = JSON.parse(cached);
        // Cache valid for 30 days
        if (Date.now() - timestamp < 30 * 24 * 60 * 60 * 1000) {
          return image;
        }
      }
    } catch (e) {
      console.warn('Cache read error:', e);
    }
    return null;
  };

  // Save to cache
  const saveToCache = (promptKey, imageData) => {
    try {
      localStorage.setItem(`coloring_cache_${promptKey}`, JSON.stringify({
        image: imageData,
        timestamp: Date.now()
      }));
      // Limit cache size to ~50 images (roughly 10MB)
      const keys = Object.keys(localStorage).filter(k => k.startsWith('coloring_cache_'));
      if (keys.length > 50) {
        // Remove oldest entries
        const sorted = keys.map(k => ({
          key: k,
          timestamp: JSON.parse(localStorage.getItem(k)).timestamp
        })).sort((a, b) => a.timestamp - b.timestamp);
        sorted.slice(0, keys.length - 50).forEach(({ key }) => localStorage.removeItem(key));
      }
    } catch (e) {
      console.warn('Cache write error (storage full?):', e);
    }
  };

  const generateImage = async () => {
    if (!prompt.trim()) return;
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:142',message:'generateImage called',data:{prompt:prompt.trim()},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
    // Rate limiting: 5 second cooldown between requests
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime.current;
    if (timeSinceLastRequest < 5000) {
      setError(`Please wait ${Math.ceil((5000 - timeSinceLastRequest) / 1000)} more seconds before generating again.`);
      return;
    }

    setIsGenerating(true);
    setError(null);
    setImageLoaded(false);
    setProgress(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsCached(false);

    const normalizedPrompt = prompt.trim().toLowerCase();
    const promptKey = hashPrompt(normalizedPrompt);
    
    // Check cache first
    const cachedImage = getCachedImage(promptKey);
    if (cachedImage) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:168',message:'Using cached image',data:{promptKey},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      setIsCached(true);
      processImage(cachedImage);
      setIsGenerating(false);
      return;
    }

    // Call backend proxy (handles Replicate API with API key securely)
    try {
      lastRequestTime.current = now;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:177',message:'Fetching from API',data:{url:'http://localhost:3001/api/generate',prompt},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      const response = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:188',message:'API response received',data:{ok:response.ok,status:response.status,statusText:response.statusText},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:192',message:'API error response',data:{status:response.status,error:errorData.error||errorData.message||'Unknown error'},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        throw new Error(errorData.error || `Failed to generate: ${response.status}`);
      }

      const result = await response.json();
      const base64Image = result.image;
      
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:197',message:'API success',data:{hasImage:!!base64Image,imageLength:base64Image?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      if (!base64Image) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:200',message:'No image in response',data:{resultKeys:Object.keys(result)},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        throw new Error('No image returned from server');
      }
      
      // Save to cache and process
      saveToCache(promptKey, base64Image);
      processImage(base64Image);

    } catch (err) {
      console.error('Generation error:', err);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:207',message:'Generation catch block',data:{errorMessage:err.message,errorName:err.name,errorStack:err.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      setError(err.message || "AI is busy! Try again in a second.");
      setIsGenerating(false);
    }
  };

  const processImage = (src) => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:208',message:'processImage called',data:{srcLength:src?.length||0,srcType:typeof src},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = (err) => {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:212',message:'Image load error',data:{error:err.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      console.error('Image load error:', err);
      setError('Failed to load image');
      setIsGenerating(false);
    };
    img.onload = () => {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:201',message:'processImage started',data:{imgWidth:img.width,imgHeight:img.height,srcLength:src.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      // Use original image resolution - no scaling = maximum sharpness
      // Gemini Canvas likely keeps images at original resolution
      const size = Math.min(img.width, img.height); // Use 1024 if image is 1024x1024
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:215',message:'Canvas size decision',data:{size,imgWidth:img.width,imgHeight:img.height},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix7',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      // Set canvas size BEFORE processing to avoid resize blur
      if (drawCanvasRef.current.width !== size || drawCanvasRef.current.height !== size) {
        drawCanvasRef.current.width = size;
        drawCanvasRef.current.height = size;
      }
      if (linesCanvasRef.current.width !== size || linesCanvasRef.current.height !== size) {
        linesCanvasRef.current.width = size;
        linesCanvasRef.current.height = size;
      }
      
      const dCtx = drawCanvasRef.current.getContext('2d');
      const lCtx = linesCanvasRef.current.getContext('2d');

      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:260',message:'Before setting smoothing',data:{dCtxSmoothing:dCtx.imageSmoothingEnabled,lCtxSmoothing:lCtx.imageSmoothingEnabled,canvasWidth:dCtx.canvas.width,canvasHeight:dCtx.canvas.height,size},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      // Disable ALL smoothing for maximum sharpness
      dCtx.imageSmoothingEnabled = false;
      lCtx.imageSmoothingEnabled = false;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:268',message:'After setting smoothing',data:{dCtxSmoothing:dCtx.imageSmoothingEnabled,lCtxSmoothing:lCtx.imageSmoothingEnabled},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      dCtx.fillStyle = 'white';
      dCtx.fillRect(0, 0, size, size);
      lCtx.clearRect(0, 0, size, size);

      // Process at original resolution - no scaling = maximum sharpness
      // Gemini Canvas keeps images at original resolution for sharpness
      const temp = document.createElement('canvas');
      temp.width = size;
      temp.height = size;
      const tCtx = temp.getContext('2d');
      tCtx.imageSmoothingEnabled = false;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:238',message:'Before drawImage at original size',data:{tCtxSmoothing:tCtx.imageSmoothingEnabled,size,imgWidth:img.width,imgHeight:img.height},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix7',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      // Draw at original size - no scaling preserves sharpness
      const scale = Math.min(size / img.width, size / img.height);
      const x = (size / 2) - (img.width / 2) * scale;
      const y = (size / 2) - (img.height / 2) * scale;
      tCtx.drawImage(img, x, y, img.width * scale, img.height * scale);
      
      // Process at original resolution with aggressive threshold + morphological operations
      const imgData = tCtx.getImageData(0, 0, size, size);
      const lineData = lCtx.createImageData(size, size);
      
      // Step 1: Binary threshold
      const tempLineData = new Uint8Array(size * size);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        const brightness = (r + g + b) / 3;
        const idx = i / 4;
        
        // Aggressive threshold - catch everything that's not pure white
        tempLineData[idx] = brightness < 240 ? 1 : 0;
      }
      
      // Step 2: Morphological closing (dilation then erosion) to connect broken lines and smooth edges
      const dilated = new Uint8Array(size * size);
      const getPixel = (arr, x, y) => {
        if (x < 0 || x >= size || y < 0 || y >= size) return 0;
        return arr[y * size + x];
      };
      
      // Dilation: expand lines slightly (connect nearby pixels)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = y * size + x;
          dilated[idx] = tempLineData[idx] || 
            getPixel(tempLineData, x-1, y) || getPixel(tempLineData, x+1, y) || 
            getPixel(tempLineData, x, y-1) || getPixel(tempLineData, x, y+1);
        }
      }
      
      // Erosion: shrink back slightly but keep connected lines
      // Less aggressive - just smooth edges, don't remove thin lines
      const closed = new Uint8Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = y * size + x;
          // Keep pixel if it has at least 2 neighbors (preserves thin lines)
          const neighbors = [
            getPixel(dilated, x-1, y), getPixel(dilated, x+1, y),
            getPixel(dilated, x, y-1), getPixel(dilated, x, y+1)
          ].filter(n => n === 1).length;
          closed[idx] = dilated[idx] && (neighbors >= 2 || dilated[idx]) ? 1 : 0;
        }
      }
      
      // Step 3: Convert to ImageData - pure black lines on pure white
      const backgroundDetection = new Uint8Array(size * size);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const idx = i / 4;
        const isLine = closed[idx] === 1;
        
        if (isLine) {
          lineData.data[i] = 0;
          lineData.data[i + 1] = 0;
          lineData.data[i + 2] = 0;
          lineData.data[i + 3] = 255;
          imgData.data[i] = 0;
          imgData.data[i + 1] = 0;
          imgData.data[i + 2] = 0;
          backgroundDetection[idx] = 2;
        } else {
          lineData.data[i + 3] = 0;
          imgData.data[i] = 255;
          imgData.data[i + 1] = 255;
          imgData.data[i + 2] = 255;
          backgroundDetection[idx] = 0;
        }
        imgData.data[i + 3] = 255;
      }
      
      // Update canvases with processed data
      try {
        tCtx.putImageData(imgData, 0, 0);
        lCtx.putImageData(lineData, 0, 0);
        
        // Copy to draw canvas
        dCtx.drawImage(temp, 0, 0);
        
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:335',message:'After processing at original size',data:{finalSize:size,canvasWidth:dCtx.canvas.width,canvasHeight:dCtx.canvas.height},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
      } catch (canvasError) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:340',message:'Canvas update error',data:{error:canvasError.message,errorName:canvasError.name},timestamp:Date.now(),sessionId:'debug-session',runId:'error-debug',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        console.error('Canvas update error:', canvasError);
        setError('Failed to process image');
        setIsGenerating(false);
        return;
      }

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
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    setHistory(prev => [...prev.slice(-19), ctx.getImageData(0, 0, width, height)]);
    calculateProgress();
  };

  const getCanvasCoords = (e) => {
    const rect = linesCanvasRef.current.getBoundingClientRect();
    // Support both mouse and touch events
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    const visualX = clientX - rect.left;
    const visualY = clientY - rect.top;
    const canvasWidth = linesCanvasRef.current.width;
    const canvasHeight = linesCanvasRef.current.height;
    let x = (visualX / rect.width) * canvasWidth;
    let y = (visualY / rect.height) * canvasHeight;
    x = Math.max(0, Math.min(canvasWidth - 1, x));
    y = Math.max(0, Math.min(canvasHeight - 1, y));
    return { x, y };
  };

  const startInteraction = (e) => {
    if (!imageLoaded) return;
    e.preventDefault(); // Prevent scrolling on touch devices
    const coords = getCanvasCoords(e);
    isInteractingRef.current = true;
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    lastPointRef.current = { ...coords, rawX: clientX, rawY: clientY };

    // Save state before any operation for proper undo
    if (tool === 'bucket' || tool === 'brush') {
      saveToHistory();
    }

    if (tool === 'bucket') {
      performFloodFill(Math.floor(coords.x), Math.floor(coords.y));
      // Save after fill completes
      saveToHistory();
    } else if (tool === 'brush') {
      draw(coords.x, coords.y);
    }
  };

  const handlePointerMove = (e) => {
    if (!isInteractingRef.current) return;
    e.preventDefault(); // Prevent scrolling on touch devices
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    if (tool === 'hand') {
      const dx = clientX - lastPointRef.current.rawX;
      const dy = clientY - lastPointRef.current.rawY;
      setPan(prev => ({ x: prev.x + dx / zoom, y: prev.y + dy / zoom }));
      lastPointRef.current = { ...lastPointRef.current, rawX: clientX, rawY: clientY };
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
    // CRITICAL: Disable ALL smoothing for pixel-perfect sharp brush strokes
    ctx.imageSmoothingEnabled = false;
    
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const radius = Math.floor(brushSize / 2);
    const lastX = Math.floor(lastPointRef.current.x);
    const lastY = Math.floor(lastPointRef.current.y);
    const currX = Math.floor(x);
    const currY = Math.floor(y);
    
    // Get current image data
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const fillColor = hexToRgb(selectedColor);
    if (!fillColor) return;
    
    // Draw filled circle using direct pixel manipulation for pixel-perfect sharpness
    const drawCircle = (cx, cy, r) => {
      const r2 = r * r;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r2) {
            const px = cx + dx;
            const py = cy + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              data[idx] = fillColor.r;
              data[idx + 1] = fillColor.g;
              data[idx + 2] = fillColor.b;
              data[idx + 3] = 255;
            }
          }
        }
      }
    };
    
    // Draw circle at current position
    drawCircle(currX, currY, radius);
    
    // Fill gap between last point and current point
    const dx = currX - lastX;
    const dy = currY - lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 0 && distance < radius * 2) {
      const steps = Math.ceil(distance);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const px = Math.floor(lastX + dx * t);
        const py = Math.floor(lastY + dy * t);
        drawCircle(px, py, radius);
      }
    }
    
    // Put modified image data back
    ctx.putImageData(imageData, 0, 0);
    
    lastPointRef.current = { ...lastPointRef.current, x, y };
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/65d6f4cb-b1f9-40ab-b782-b00f922cdb85',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:595',message:'Brush stroke drawn (direct pixel)',data:{smoothingEnabled:ctx.imageSmoothingEnabled,brushSize,radius,distance},timestamp:Date.now(),sessionId:'debug-session',runId:'cursor-fix2',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
  };

  const performFloodFill = (startX, startY) => {
    const drawCtx = drawCanvasRef.current.getContext('2d');
    const lineCtx = linesCanvasRef.current.getContext('2d');
    // Use actual canvas size (1024 if image loaded, 800 otherwise)
    const width = drawCanvasRef.current.width;
    const height = drawCanvasRef.current.height;

    const drawData = drawCtx.getImageData(0, 0, width, height);
    const lineData = lineCtx.getImageData(0, 0, width, height);
    
    const targetColor = getPixel(drawData, startX, startY);
    const fillColor = hexToRgb(selectedColor);

    if (!targetColor || !fillColor) return;
    
    // Don't fill if already the same color
    if (colorsMatch(targetColor, [fillColor.r, fillColor.g, fillColor.b, 255], 5)) return;

    // Check if we clicked on a line - very strict threshold
    const startLineColor = getPixel(lineData, startX, startY);
    if (startLineColor && startLineColor[3] > 30) return; // Very strict: any visible line blocks fill

    // Only fill pure white areas - very strict check
    const isPureWhite = (color) => {
      return color[0] === 255 && color[1] === 255 && color[2] === 255;
    };
    
    if (!isPureWhite(targetColor)) return; // Only fill pure white areas

    // Get the exact target color for matching (must match exactly)
    const targetR = targetColor[0];
    const targetG = targetColor[1];
    const targetB = targetColor[2];

    const visited = new Set();
    const pixelsToCheck = [[startX, startY]];

    while (pixelsToCheck.length > 0) {
      const [x, y] = pixelsToCheck.pop();
      const key = `${x},${y}`;
      
      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const currentDrawColor = getPixel(drawData, x, y);
      const currentLineColor = getPixel(lineData, x, y);

      // Very strict: must match exact target color AND be pure white AND no line nearby
      if (currentDrawColor && 
          currentDrawColor[0] === targetR && 
          currentDrawColor[1] === targetG && 
          currentDrawColor[2] === targetB &&
          isPureWhite(currentDrawColor) && 
          currentLineColor && currentLineColor[3] < 30) { // Very strict line threshold
        
        // Also check neighbors for lines before filling (prevents bleeding)
        let hasNearbyLine = false;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const neighborLine = getPixel(lineData, nx, ny);
              if (neighborLine && neighborLine[3] > 100) {
                hasNearbyLine = true;
                break;
              }
            }
          }
          if (hasNearbyLine) break;
        }
        
        if (!hasNearbyLine) {
          visited.add(key);
          
          const index = (y * width + x) * 4;
          drawData.data[index] = fillColor.r;
          drawData.data[index + 1] = fillColor.g;
          drawData.data[index + 2] = fillColor.b;
          drawData.data[index + 3] = 255;

          // Add neighbors
          pixelsToCheck.push([x - 1, y]);
          pixelsToCheck.push([x + 1, y]);
          pixelsToCheck.push([x, y - 1]);
          pixelsToCheck.push([x, y + 1]);
        }
      }
    }
    drawCtx.putImageData(drawData, 0, 0);
    // Don't save here - let stopInteraction handle it to avoid double save
  };

  const getPixel = (p, x, y) => {
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return null;
    const i = (y * p.width + x) * 4;
    return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
  };

  const colorsMatch = (c1, c2, t = 5) => 
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
    const canvasWidth = drawCanvasRef.current.width;
    const canvasHeight = drawCanvasRef.current.height;
    final.width = canvasWidth;
    final.height = canvasHeight;
    const fCtx = final.getContext('2d');
    fCtx.imageSmoothingEnabled = false;
    fCtx.drawImage(drawCanvasRef.current, 0, 0); 
    fCtx.drawImage(linesCanvasRef.current, 0, 0);
    const link = document.createElement('a'); 
    link.download = 'my-art.png'; 
    link.href = final.toDataURL(); 
    link.click();
  };

  const handlePrint = () => {
    const final = document.createElement('canvas');
    const canvasWidth = drawCanvasRef.current.width;
    const canvasHeight = drawCanvasRef.current.height;
    final.width = canvasWidth;
    final.height = canvasHeight;
    const fCtx = final.getContext('2d');
    fCtx.imageSmoothingEnabled = false;
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
    <div className="min-h-screen bg-amber-50 font-sans text-slate-800 p-2 sm:p-4 md:p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full text-center mb-3 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-orange-500 flex items-center justify-center gap-2 sm:gap-3 drop-shadow-sm uppercase tracking-tighter">
          <Palette className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10" /> AI Coloring Magic
        </h1>
      </div>

      <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 md:gap-6 items-start">
        <div className="lg:col-span-4 space-y-3 sm:space-y-4 order-2 lg:order-1">
          <div className="bg-white p-3 sm:p-4 md:p-5 rounded-2xl sm:rounded-3xl shadow-lg border-2 sm:border-4 border-white">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={prompt} 
                onChange={(e) => setPrompt(e.target.value)} 
                placeholder="A happy dragon..." 
                className="flex-1 bg-slate-100 border-none rounded-xl sm:rounded-2xl px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base outline-none transition-all font-medium" 
                onKeyDown={(e) => e.key === 'Enter' && generateImage()}
              />
              <button 
                onClick={generateImage} 
                disabled={isGenerating || !prompt.trim()} 
                className="p-2 sm:p-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 text-white rounded-xl sm:rounded-2xl shadow-md active:scale-95 transition-transform min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                {isGenerating ? <Loader2 className="animate-spin w-5 h-5 sm:w-6 sm:h-6" /> : <Search className="w-5 h-5 sm:w-6 sm:h-6" />}
              </button>
            </div>
            {isCached && (
              <div className="mt-2 text-xs text-green-600 font-medium flex items-center gap-1">
                <span>✓</span> Loaded from cache (free!)
              </div>
            )}
          </div>

          <div className="bg-white p-3 sm:p-4 md:p-5 rounded-2xl sm:rounded-3xl shadow-lg border-2 sm:border-4 border-white">
            <h2 className="text-xs font-bold text-slate-400 mb-2 sm:mb-3 uppercase tracking-widest flex items-center gap-2"><ZoomIn size={12} className="sm:w-3.5 sm:h-3.5"/> Zoom Tool</h2>
            <div className="flex items-center gap-2 sm:gap-4">
              <input 
                type="range" 
                min="1" 
                max="4" 
                step="0.1" 
                value={zoom} 
                onChange={(e) => setZoom(parseFloat(e.target.value))} 
                className="flex-1 accent-orange-500 h-2 sm:h-3"
              />
              <button 
                onClick={() => { setZoom(1); setPan({x:0, y:0}); }} 
                className="text-xs font-bold text-orange-500 bg-orange-50 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border border-orange-200 min-h-[44px]"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-4 md:p-5 rounded-2xl sm:rounded-3xl shadow-lg border-2 sm:border-4 border-white">
            <div className="grid grid-cols-3 gap-2 mb-3 sm:mb-4">
              <button 
                onClick={() => setTool('brush')} 
                className={`flex flex-col items-center justify-center gap-1 p-2 sm:p-3 rounded-xl sm:rounded-2xl font-bold border-b-2 sm:border-b-4 transition-all min-h-[60px] sm:min-h-[80px] ${tool === 'brush' ? 'bg-orange-500 text-white border-orange-700 -translate-y-1' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}
              >
                <Brush size={18} className="sm:w-5 sm:h-5"/> 
                <span className="text-[10px] sm:text-xs">Brush</span>
              </button>
              <button 
                onClick={() => setTool('bucket')} 
                className={`flex flex-col items-center justify-center gap-1 p-2 sm:p-3 rounded-xl sm:rounded-2xl font-bold border-b-2 sm:border-b-4 transition-all min-h-[60px] sm:min-h-[80px] ${tool === 'bucket' ? 'bg-blue-500 text-white border-blue-700 -translate-y-1' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}
              >
                <PaintBucket size={18} className="sm:w-5 sm:h-5"/> 
                <span className="text-[10px] sm:text-xs">Fill</span>
              </button>
              <button 
                onClick={() => setTool('hand')} 
                className={`flex flex-col items-center justify-center gap-1 p-2 sm:p-3 rounded-xl sm:rounded-2xl font-bold border-b-2 sm:border-b-4 transition-all min-h-[60px] sm:min-h-[80px] ${tool === 'hand' ? 'bg-purple-500 text-white border-purple-700 -translate-y-1' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}
              >
                <Move size={18} className="sm:w-5 sm:h-5"/> 
                <span className="text-[10px] sm:text-xs">Move</span>
              </button>
            </div>
            {tool === 'brush' && (
              <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-slate-200">
                <label className="text-xs font-bold text-slate-400 mb-2 block uppercase tracking-widest">Brush Size</label>
                <input 
                  type="range" 
                  min="5" 
                  max="40" 
                  step="5" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))} 
                  className="w-full accent-orange-500 h-2 sm:h-3"
                />
                <div className="text-xs text-slate-500 text-center mt-1">{brushSize}px</div>
              </div>
            )}
          </div>

          <div className="bg-white p-3 sm:p-4 md:p-5 rounded-2xl sm:rounded-3xl shadow-lg border-2 sm:border-4 border-white grid grid-cols-6 sm:grid-cols-6 gap-1.5 sm:gap-2">
            {COLORS.map((color) => (
              <button 
                key={color} 
                onClick={() => setSelectedColor(color)} 
                className={`w-full aspect-square rounded-full border-2 sm:border-4 transition-all min-h-[36px] sm:min-h-[44px] ${selectedColor === color ? 'border-slate-800 scale-110 shadow-md rotate-6' : 'border-transparent hover:scale-110'}`} 
                style={{ backgroundColor: color }} 
              />
            ))}
          </div>

          {/* Sidebar Actions */}
          <div className="bg-white p-3 sm:p-4 rounded-2xl sm:rounded-3xl shadow-lg border-2 sm:border-4 border-white flex gap-2">
             <button 
                onClick={handleSave} 
                disabled={!imageLoaded} 
                className="flex-1 bg-green-500 hover:bg-green-600 p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-md font-bold text-white border-b-2 sm:border-b-4 border-green-700 active:translate-y-1 active:border-b-0 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm sm:text-base min-h-[44px]"
              >
                <Download size={18} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Save</span>
              </button>
              <button 
                onClick={handlePrint} 
                disabled={!imageLoaded} 
                className="flex-1 bg-blue-500 hover:bg-blue-600 p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-md font-bold text-white border-b-2 sm:border-b-4 border-blue-700 active:translate-y-1 active:border-b-0 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm sm:text-base min-h-[44px]"
              >
                <Printer size={18} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Print</span>
              </button>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-3 sm:space-y-4 order-1 lg:order-2">
          {/* Progress Bar */}
          <div className="bg-white p-3 sm:p-4 rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-white">
            <div className="flex items-center justify-between mb-2 px-1 sm:px-2">
              <span className="text-xs sm:text-sm font-black text-slate-500 uppercase tracking-widest">Masterpiece Meter</span>
              <span className="text-lg sm:text-xl font-bold flex items-center gap-1">
                {getProgressIcon()} {progress}%
              </span>
            </div>
            <div className="h-5 sm:h-6 bg-slate-100 rounded-full overflow-hidden border-2 border-slate-100">
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

          <div ref={containerRef} className="relative bg-white p-1 sm:p-2 rounded-2xl sm:rounded-[40px] shadow-2xl border-4 sm:border-8 border-white ring-2 sm:ring-4 ring-orange-100 w-full max-w-[600px] aspect-square overflow-hidden cursor-crosshair">
            {isGenerating && (
              <div className="absolute inset-0 z-30 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center px-4">
                <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-orange-500 animate-spin mb-3 sm:mb-4" />
                <h3 className="text-lg sm:text-2xl font-black text-slate-700 text-center">Magical Art in Progress...</h3>
              </div>
            )}
            <div style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: 'center center', transition: isInteractingRef.current ? 'none' : 'transform 0.1s ease-out', willChange: 'transform', imageRendering: 'crisp-edges', WebkitImageRendering: 'crisp-edges' }} className="absolute inset-0 w-full h-full">
              <canvas ref={drawCanvasRef} style={{ imageRendering: 'crisp-edges', WebkitImageRendering: 'crisp-edges' }} className="absolute inset-0 w-full h-full bg-white pointer-events-none" />
              <canvas 
                ref={linesCanvasRef} 
                style={{ imageRendering: 'crisp-edges', WebkitImageRendering: 'crisp-edges', touchAction: 'none' }} 
                onPointerDown={startInteraction} 
                onPointerMove={handlePointerMove} 
                onPointerUp={stopInteraction} 
                onPointerLeave={stopInteraction}
                onTouchStart={startInteraction}
                onTouchMove={handlePointerMove}
                onTouchEnd={stopInteraction}
                className="absolute inset-0 w-full h-full touch-none" 
              />
            </div>
            {!imageLoaded && !isGenerating && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-slate-300 pointer-events-none px-4">
                <ImageIcon size={48} className="sm:w-16 sm:h-16 mb-3 sm:mb-4 opacity-50" />
                <p className="font-black text-base sm:text-xl text-center">Type a prompt to start!</p>
              </div>
            )}

            {/* Corner Undo Button */}
            {imageLoaded && (
              <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-40">
                <button 
                  onClick={undo} 
                  disabled={history.length <= 1} 
                  className="bg-white/80 hover:bg-white p-2 sm:p-3 rounded-full shadow-lg text-slate-600 hover:text-orange-500 border-2 border-white/50 transition-all active:scale-90 disabled:opacity-0 disabled:pointer-events-none min-w-[44px] min-h-[44px] flex items-center justify-center"
                  title="Undo"
                >
                  <RotateCcw size={20} className="sm:w-6 sm:h-6" />
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
