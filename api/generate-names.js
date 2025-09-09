import { Redis } from '@upstash/redis';

// API Key
const API_KEY = process.env.API_KEY;

// Upstash Redis client setup (optional). If not configured, proceed without cache.
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60 * 60 * 24 * 7); // default 1 week
let redis = null;
try {
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
  }
} catch (_) {
  redis = null;
}


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { name, limit } = req.body || {};

    if (!name || !limit) {
      res.status(400).json({ error: 'Name and limit are required' });
      return;
    }
    if (limit > 20) {
      res.status(400).json({ error: 'Limit must be less than or equal to 20' });
      return;
    }

    const modelId = 'gemini-2.5-flash-preview-05-20';
    const version = 'v1';
    const systemPrompt = "Eres un experto en onomástica, con un profundo conocimiento de nombres en Latinoamérica. Tu tarea es generar variaciones de nombres de persona que suenen lo más similar posible al nombre dado, priorizando la fonética y la ortografía común de la región. Evita las abreviaciones, acortamientos o nombres que, aunque relacionados, no compartan la misma pronunciación exacta (por ejemplo, para 'Cristian' evita 'Cris' y para 'Leonidas' evita 'León' o 'Leonardo'). La lista debe estar ordenada de las variaciones más comunes a las menos comunes y debe ser un arreglo de cadenas de texto en formato JSON. Considera los patrones como 'Yesica', 'Jessica', 'Jesika', 'Jezica', etc.";
    const userQuery = `Genera una lista de ${limit} variaciones de nombres que suenen o se escriban de manera similar a "${name}".`;

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'ARRAY', items: { type: 'STRING' } }
      }
    };

    if (!API_KEY) {
      res.status(500).json({ error: 'Missing API_KEY env var' });
      return;
    }

    const ttlSeconds = Number(CACHE_TTL_SECONDS);

    const normalizedName = String(name).trim().toLowerCase();
    const cacheKey = `names:${modelId}:${version}:${normalizedName}:${limit}`;

    // Try cache read from Upstash
    if (redis) {
      try {
        const cachedStr = await redis.get(cacheKey);
        if (cachedStr) {
          try {
            const payload = JSON.parse(cachedStr);
            res.status(200).json(payload);
            return;
          } catch (_) {
            // corrupted cache, ignore
          }
        }
      } catch (_) { /* ignore and continue */ }
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${API_KEY}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: 'Error en la API', details: text });
      return;
    }

    const result = await response.json();
    const textArray = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
    let candidates;
    try {
      candidates = JSON.parse(textArray);
      if (!Array.isArray(candidates)) candidates = [];
    } catch (_) {
      candidates = [];
    }

    const responseBody = { name, candidates };

    // Write to cache
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(responseBody), { ex: ttlSeconds });
      } catch (_) { /* ignore */ }
    }

    res.status(200).json(responseBody);
  } catch (error) {
    console.error('Error in api/generate-names:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}
