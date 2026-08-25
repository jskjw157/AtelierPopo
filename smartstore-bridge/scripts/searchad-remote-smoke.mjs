#!/usr/bin/env node
const baseUrl = String(process.env.ATELIER_BASE_URL || '').replace(/\/$/, '');
const apiKey = process.env.ATELIER_API_KEY || '';
if (!baseUrl || !apiKey) {
  console.error('ATELIER_BASE_URL and ATELIER_API_KEY are required.');
  process.exit(1);
}
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const status = await request('/api/v1/searchad/status');
const operations = await request('/api/v1/searchad/operations?runtimeOnly=true&limit=5');
console.log(JSON.stringify({ ok: true, status, sampleOperationCount: operations.items?.length || 0 }, null, 2));
