const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const DEFAULT_MODELS = {
  'openrouter': 'openai/gpt-4o-mini',
  'z-ai': 'glm-4.5v'
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === 'GET' && url.pathname === '/api/ai/config') {
      return sendJson(res, 200, {
        ok: true,
        providers: {
          openrouter: {
            available: Boolean(process.env.OPENROUTER_API_KEY),
            defaultModel: DEFAULT_MODELS.openrouter,
          },
          'z-ai': {
            available: Boolean(process.env.ZAI_API_KEY || process.env.ZAI_AUTH_TOKEN),
            defaultModel: DEFAULT_MODELS['z-ai'],
          }
        },
        proxyUrl: '/api/ai/estimate'
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/ai/estimate') {
      const body = await readJson(req);
      const provider = body.provider === 'z-ai' ? 'z-ai' : 'openrouter';
      const model = String(body.model || DEFAULT_MODELS[provider]).trim() || DEFAULT_MODELS[provider];
      const text = String(body.text || '').trim();
      const photoDataUrl = typeof body.photoDataUrl === 'string' ? body.photoDataUrl : '';

      if (!text && !photoDataUrl) {
        return sendJson(res, 400, { ok: false, error: '请至少提供食物描述或一张照片。' });
      }

      const result = provider === 'z-ai'
        ? await callZai({ model, text, photoDataUrl })
        : await callOpenRouter({ model, text, photoDataUrl });

      return sendJson(res, 200, { ok: true, result });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: error.message || '服务器错误' });
  }
}).listen(PORT, HOST, () => {
  console.log(`Kawaii Calorie Tracker listening on http://${HOST}:${PORT}`);
});

async function callOpenRouter({ model, text, photoDataUrl }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('缺少 OPENROUTER_API_KEY');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'kawaii-calorie-tracker'
    },
    body: JSON.stringify(buildChatCompletionPayload({ model, text, photoDataUrl }))
  });
  return normalizeProviderResponse(await response.json(), response, 'openrouter');
}

async function callZai({ model, text, photoDataUrl }) {
  const token = process.env.ZAI_API_KEY || process.env.ZAI_AUTH_TOKEN;
  if (!token) throw new Error('缺少 ZAI_API_KEY 或 ZAI_AUTH_TOKEN');
  const response = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildChatCompletionPayload({ model, text, photoDataUrl }))
  });
  return normalizeProviderResponse(await response.json(), response, 'z-ai');
}

function buildChatCompletionPayload({ model, text, photoDataUrl }) {
  const content = [];
  if (text) content.push({ type: 'text', text: buildPrompt(text) });
  else content.push({ type: 'text', text: buildPrompt('请根据图片判断食物并估算热量。') });
  if (photoDataUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: photoDataUrl }
    });
  }
  return {
    model,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content,
      }
    ]
  };
}

function buildPrompt(text) {
  return [
    '你是一个食物热量估算助手。',
    '请结合用户描述和图片（如果有）给出一个尽量稳健的估算。',
    '只返回 JSON，对象字段固定为：foodName, estimatedCalories, confidence, reasoning, portionNote。',
    'estimatedCalories 必须是整数。confidence 只能是 low、medium、high。',
    `用户输入：${text}`
  ].join('\n');
}

function normalizeProviderResponse(payload, response, provider) {
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `请求 ${provider} 失败 (${response.status})`;
    throw new Error(message);
  }
  const rawContent = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(rawContent)
    ? rawContent.map((item) => item?.text || '').join('')
    : String(rawContent || '').trim();
  const parsed = JSON.parse(text);
  return {
    foodName: String(parsed.foodName || '未命名食物').trim(),
    estimatedCalories: Math.max(0, Math.round(Number(parsed.estimatedCalories) || 0)),
    confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    reasoning: String(parsed.reasoning || '').trim(),
    portionNote: String(parsed.portionNote || '').trim(),
    provider
  };
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return sendJson(res, 404, { ok: false, error: 'Not found' });
      return sendJson(res, 500, { ok: false, error: 'Failed to read file' });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('请求体 JSON 无效'));
      }
    });
    req.on('error', reject);
  });
}
