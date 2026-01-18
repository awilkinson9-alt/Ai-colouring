import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Proxy endpoint for Google Vertex AI Imagen API
app.post('/api/generate', async (req, res) => {
  const projectId = process.env.GOOGLE_PROJECT_ID || "refined-bolt-484702-d1";
  const region = process.env.GOOGLE_REGION || "us-central1";
  // Service account key file path (set in .env or use default name)
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || 
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    'refined-bolt-484702-d1-b1536dbbb48f.json';

  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Gemini Canvas "Magic Prompt" - proven to work well
    const fullPrompt = `simple black and white coloring book illustration for kids, thick bold black outlines, pure white background, no shading, no gradients, clean vector style, high contrast, outline only, no filled areas: ${prompt}`;

    // Set up Google Auth - Vertex AI requires service account authentication
    let auth;
    const fs = await import('fs');
    const path = await import('path');
    
    // Check if serviceAccountKey is a file path or JSON string
    const keyPath = path.isAbsolute(serviceAccountKey) 
      ? serviceAccountKey 
      : path.join(process.cwd(), serviceAccountKey);
    
    if (fs.existsSync(keyPath)) {
      // It's a file path - use it directly
      auth = new GoogleAuth({
        keyFilename: keyPath,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
    } else {
      // Try to parse as JSON string
      try {
        const keyJson = JSON.parse(serviceAccountKey);
        auth = new GoogleAuth({
          credentials: keyJson,
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
      } catch (e) {
        // Fallback to Application Default Credentials
        auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
      }
    }

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // Vertex AI Imagen endpoint - try Imagen 4.0 first (like Gemini Canvas), fallback to 3.0
    let vertexEndpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/imagen-4.0-generate-001:predict`;
    let modelVersion = '4.0';

    let response;
    try {
      // Try Imagen 4.0 first (like Gemini Canvas uses)
      response = await fetch(vertexEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.token}`
        },
        body: JSON.stringify({
          instances: [{
            prompt: fullPrompt
          }],
          parameters: {
            sampleCount: 1,
            aspectRatio: "1:1",
            safetyFilterLevel: "block_some",
            personGeneration: "allow_all",
            outputOptions: {
              mimeType: "image/png"
            }
          }
        })
      });
      
      // If 4.0 not available, fallback to 3.0
      if (!response.ok && response.status === 404) {
        vertexEndpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/imagen-3.0-generate-001:predict`;
        modelVersion = '3.0';
        console.log('⚠️ Imagen 4.0 not available, falling back to 3.0');
        response = await fetch(vertexEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken.token}`
          },
          body: JSON.stringify({
            instances: [{
              prompt: fullPrompt
            }],
            parameters: {
              sampleCount: 1,
              aspectRatio: "1:1",
              safetyFilterLevel: "block_some",
              personGeneration: "allow_all",
              outputOptions: {
                mimeType: "image/png"
              }
            }
          })
        });
      }
    } catch (error) {
      // If 4.0 fails, try 3.0
      vertexEndpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/imagen-3.0-generate-001:predict`;
      modelVersion = '3.0';
      console.log('⚠️ Imagen 4.0 failed, falling back to 3.0:', error.message);
      response = await fetch(vertexEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.token}`
        },
        body: JSON.stringify({
          instances: [{
            prompt: fullPrompt
          }],
          parameters: {
            sampleCount: 1,
            aspectRatio: "1:1",
            safetyFilterLevel: "block_some",
            personGeneration: "allow_all",
            outputOptions: {
              mimeType: "image/png"
            }
          }
        })
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 401 || response.status === 403) {
        const errorMsg = errorData.error?.message || errorData.message || '';
        let helpfulMsg = errorMsg;
        
        if (errorMsg.includes('billing')) {
          helpfulMsg = `Billing not enabled for this project. Even with a payment method, you need to: 1) Go to https://console.cloud.google.com/billing 2) Make sure your billing account is linked to project "refined-bolt-484702-d1" 3) Wait 2-5 minutes after linking. Error: ${errorMsg}`;
        } else if (errorMsg.includes('permission') || errorMsg.includes('access')) {
          helpfulMsg = `Permission denied. Make sure the service account "ai-coloring@refined-bolt-484702-d1.iam.gserviceaccount.com" has the "Vertex AI User" role. Error: ${errorMsg}`;
        }
        
        return res.status(response.status).json({ 
          error: helpfulMsg
        });
      }
      
      return res.status(response.status).json({ 
        error: errorData.error?.message || errorData.message || `API error: ${response.status}` 
      });
    }

    const result = await response.json();
    
    if (!result.predictions || !result.predictions[0] || !result.predictions[0].bytesBase64Encoded) {
      return res.status(500).json({ error: 'Invalid response from Vertex AI API' });
    }

    const base64Image = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
    res.json({ image: base64Image });

  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
