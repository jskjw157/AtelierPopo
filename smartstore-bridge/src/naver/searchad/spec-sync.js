import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

export function gitBlobSha(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(buffer).digest('hex');
}

export function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function normalizeSwaggerPath(rawPath) {
  let value = String(rawPath || '').trim();
  const templateQuery = [];
  const templateMatch = value.match(/\{\?([^}]+)\}$/);
  if (templateMatch) {
    templateQuery.push(...templateMatch[1].split(',').map(item => item.trim()).filter(Boolean));
    value = value.slice(0, templateMatch.index);
  }
  value = value.replace(/^\/api(?=\/)/, '');
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/{2,}/g, '/');
  return { path: value, templateQuery };
}

function sanitizeKey(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unnamed';
}

function mergeParameters(pathParameters, operationParameters, templateQuery) {
  const combined = [...(pathParameters || []), ...(operationParameters || [])];
  const byKey = new Map();
  for (const item of combined) {
    if (!item || typeof item !== 'object') continue;
    const location = String(item.in || '').toLowerCase();
    const name = String(item.name || '').trim();
    if (!location || !name) continue;
    const key = `${location}:${name}`;
    const normalized = {
      name,
      in: location,
      required: location === 'path' ? true : Boolean(item.required),
      type: item.type || item.schema?.type || null,
      format: item.format || item.schema?.format || null,
      enum: item.enum || item.schema?.enum || null,
      collectionFormat: item.collectionFormat || null,
      description: item.description || null,
      schemaRef: item.schema?.$ref || null,
      schema: item.schema && !item.schema.$ref ? item.schema : null
    };
    byKey.set(key, normalized);
  }
  for (const name of templateQuery) {
    const key = `query:${name}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name,
        in: 'query',
        required: false,
        type: 'string',
        format: null,
        enum: null,
        collectionFormat: null,
        description: 'Recovered from Swagger URI query template.',
        schemaRef: null,
        schema: null
      });
    }
  }
  return [...byKey.values()];
}

function tagIsQuarantined(tags, description, corrections) {
  const hidden = new Set((corrections.initiallyQuarantinedTags || []).map(item => String(item).toLowerCase()));
  const patterns = (corrections.quarantinedTagPatterns || []).map(item => new RegExp(item, 'i'));
  if (String(description || '').toLowerCase().includes('#hidden')) return true;
  return tags.some(tag => {
    const normalized = String(tag).toLowerCase();
    return hidden.has(normalized) || patterns.some(pattern => pattern.test(normalized));
  });
}

function inferAction(method, summary, operationId) {
  const text = `${summary || ''} ${operationId || ''}`.toLowerCase();
  if (method === 'get' || method === 'head') return 'read';
  if (method === 'delete') return 'delete';
  if (/(create|add|register|upload|issue|request)/.test(text) || method === 'post') return 'create';
  if (/(update|modify|change|edit|set)/.test(text) || ['put', 'patch'].includes(method)) return 'update';
  return 'write';
}

function inferConfirmation(action, batch) {
  if (action === 'read') return null;
  if (action === 'delete') return 'DELETE_AD_ENTITY';
  if (batch) return 'EXECUTE_AD_BATCH';
  if (action === 'create') return 'CREATE_AD_ENTITY';
  return 'UPDATE_AD_ENTITY';
}

function inferDomain(tags, sourceId, normalizedPath) {
  const firstTag = tags[0];
  if (firstTag) return sanitizeKey(firstTag);
  const segment = normalizedPath.split('/').filter(Boolean)[1] || normalizedPath.split('/').filter(Boolean)[0];
  return sanitizeKey(segment || sourceId);
}

function inferBatch(operation, parameters) {
  const body = parameters.find(item => item.in === 'body');
  return body?.schema?.type === 'array' || /multiple|items|bulk|batch|다건|여러/.test(String(operation.summary || operation.description || '').toLowerCase());
}

function stableOperationKey({ sourceId, method, normalizedPath, operationId, templateQuery }) {
  const operationPart = sanitizeKey(operationId || `${method}_${normalizedPath}`);
  const pathPart = sanitizeKey(normalizedPath);
  const queryPart = templateQuery.length ? `__q_${templateQuery.map(sanitizeKey).sort().join('_')}` : '';
  return `${sanitizeKey(sourceId)}.${method}.${operationPart}__p_${pathPart}${queryPart}`;
}

function classifyOperation({ operation, tags, corrections }) {
  if (operation.deprecated) return { state: 'deprecated', runtimeAllowlisted: false, tier: 'E' };
  if (tagIsQuarantined(tags, operation.description, corrections)) {
    return { state: 'internal_quarantined', runtimeAllowlisted: false, tier: 'D' };
  }
  return { state: 'public_documented', runtimeAllowlisted: true, tier: 'B' };
}

export function buildSearchAdManifest({ sources, sourceManifest, corrections, generatedAt = new Date().toISOString() }) {
  const operations = [];
  const definitions = {};
  const operationKeys = new Set();
  const sourceSummaries = [];

  for (const sourceEntry of sourceManifest.sources) {
    const swagger = sources[sourceEntry.file];
    if (!swagger || typeof swagger !== 'object') throw new Error(`Missing Swagger source ${sourceEntry.file}`);
    const sourceId = sourceEntry.id;
    const sourceOperationsStart = operations.length;
    for (const [name, schema] of Object.entries(swagger.definitions || {})) {
      definitions[`${sourceId}:${name}`] = {
        sourceId,
        name,
        type: schema.type || 'object',
        properties: Object.keys(schema.properties || {}),
        required: schema.required || []
      };
    }
    for (const [rawPath, pathItem] of Object.entries(swagger.paths || {})) {
      const pathParameters = pathItem.parameters || [];
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method.toLowerCase()) || !operation || typeof operation !== 'object') continue;
        const lowerMethod = method.toLowerCase();
        const { path: normalizedPath, templateQuery } = normalizeSwaggerPath(rawPath);
        const parameters = mergeParameters(pathParameters, operation.parameters, templateQuery);
        const tags = Array.isArray(operation.tags) ? operation.tags : [];
        const classification = classifyOperation({ operation, tags, corrections });
        const action = inferAction(lowerMethod, operation.summary, operation.operationId);
        const batch = inferBatch(operation, parameters);
        const destructive = action === 'delete';
        const sideEffect = action !== 'read';
        const operationKey = stableOperationKey({
          sourceId,
          method: lowerMethod,
          normalizedPath,
          operationId: operation.operationId,
          templateQuery
        });
        if (operationKeys.has(operationKey)) throw new Error(`Duplicate SearchAd operationKey: ${operationKey}`);
        operationKeys.add(operationKey);
        operations.push({
          operationKey,
          sourceId,
          sourceFile: sourceEntry.file,
          sourceOperationId: operation.operationId || null,
          method: lowerMethod.toUpperCase(),
          rawPath,
          path: normalizedPath,
          templateQuery,
          tags,
          domain: inferDomain(tags, sourceId, normalizedPath),
          summary: operation.summary || null,
          description: operation.description || null,
          action,
          sideEffect,
          destructive,
          batch,
          risk: destructive ? 'critical' : sideEffect ? 'high' : 'low',
          state: classification.state,
          tier: classification.tier,
          runtimeAllowlisted: classification.runtimeAllowlisted,
          requiredGate: action === 'read' ? 'reads' : action === 'delete' ? 'deletes' : action === 'create' ? 'creates' : batch ? 'batchWrites' : 'writes',
          confirmation: inferConfirmation(action, batch),
          parameters,
          responseCodes: Object.keys(operation.responses || {}),
          capabilityKey: `${inferDomain(tags, sourceId, normalizedPath)}.${action}`,
          specRef: sourceManifest.ref
        });
      }
    }
    sourceSummaries.push({
      id: sourceId,
      file: sourceEntry.file,
      gitBlobSha: sourceEntry.gitBlobSha,
      size: sourceEntry.size,
      operationCount: operations.length - sourceOperationsStart,
      definitionCount: Object.keys(swagger.definitions || {}).length,
      swaggerVersion: swagger.swagger || swagger.openapi || null,
      infoVersion: swagger.info?.version || null,
      title: swagger.info?.title || null
    });
  }

  operations.sort((a, b) => a.operationKey.localeCompare(b.operationKey));
  const stateCounts = {};
  const gateCounts = {};
  const domainCounts = {};
  for (const item of operations) {
    stateCounts[item.state] = (stateCounts[item.state] || 0) + 1;
    gateCounts[item.requiredGate] = (gateCounts[item.requiredGate] || 0) + 1;
    domainCounts[item.domain] = (domainCounts[item.domain] || 0) + 1;
  }

  const manifest = {
    schemaVersion: 1,
    product: 'naver-searchad',
    generatedAt,
    specRepository: sourceManifest.repository,
    specRef: sourceManifest.ref,
    baseUrl: corrections.baseUrl || 'https://api.searchad.naver.com',
    sources: sourceSummaries,
    operations,
    definitions,
    reportLifecycle: corrections.deprecatedReports || {},
    counts: {
      rawOperations: operations.length,
      runtimeAllowlisted: operations.filter(item => item.runtimeAllowlisted).length,
      sideEffect: operations.filter(item => item.sideEffect).length,
      destructive: operations.filter(item => item.destructive).length,
      unclassified: operations.filter(item => !item.state).length,
      duplicateOperationKeys: 0,
      states: stateCounts,
      gates: gateCounts,
      domains: domainCounts,
      definitions: Object.keys(definitions).length
    }
  };

  const coverage = {
    ok: manifest.counts.rawOperations > 0 && manifest.counts.unclassified === 0 && manifest.counts.duplicateOperationKeys === 0,
    generatedAt,
    specRef: sourceManifest.ref,
    ...manifest.counts,
    sourceCount: sourceManifest.sources.length,
    internalOrDeprecatedRuntimeLeaks: operations.filter(item => ['internal_quarantined', 'deprecated'].includes(item.state) && item.runtimeAllowlisted).length
  };
  coverage.ok = coverage.ok && coverage.internalOrDeprecatedRuntimeLeaks === 0;
  return { manifest, coverage };
}

async function fetchSource(sourceManifest, source, fetchImpl) {
  const url = `${sourceManifest.baseRawUrl.replace(/\/$/, '')}/${source.file}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Failed to fetch ${source.file}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (source.size && buffer.length !== source.size) throw new Error(`Size mismatch for ${source.file}: expected ${source.size}, got ${buffer.length}`);
  const actualGitSha = gitBlobSha(buffer);
  if (source.gitBlobSha && actualGitSha !== source.gitBlobSha) {
    throw new Error(`Git blob SHA mismatch for ${source.file}: expected ${source.gitBlobSha}, got ${actualGitSha}`);
  }
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch (error) { throw new Error(`Invalid JSON in ${source.file}: ${error.message}`); }
  return { buffer, parsed, url, sha256: sha256(buffer), gitBlobSha: actualGitSha };
}

export async function syncPinnedSearchAdSpec({
  sourceManifestPath,
  correctionsPath,
  outputRoot,
  fetchImpl = globalThis.fetch,
  writeSources = true,
  now = () => new Date()
}) {
  if (!fetchImpl) throw new Error('syncPinnedSearchAdSpec requires fetch.');
  const sourceManifest = readJson(sourceManifestPath);
  const corrections = readJson(correctionsPath);
  const sources = {};
  const fetchedMetadata = [];
  for (const source of sourceManifest.sources) {
    const fetched = await fetchSource(sourceManifest, source, fetchImpl);
    sources[source.file] = fetched.parsed;
    fetchedMetadata.push({ ...source, url: fetched.url, sha256: fetched.sha256, gitBlobSha: fetched.gitBlobSha, size: fetched.buffer.length });
    if (writeSources) {
      const destination = path.join(outputRoot, 'source', 'swagger', source.file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, fetched.buffer);
    }
  }
  const generatedAt = now().toISOString();
  const { manifest, coverage } = buildSearchAdManifest({ sources, sourceManifest, corrections, generatedAt });
  manifest.sources = manifest.sources.map(item => ({
    ...item,
    sha256: fetchedMetadata.find(source => source.file === item.file)?.sha256 || null
  }));
  const versionDir = path.join(outputRoot, 'versions', sourceManifest.ref);
  writeJson(path.join(outputRoot, 'current.json'), manifest);
  writeJson(path.join(outputRoot, 'coverage.json'), coverage);
  writeJson(path.join(outputRoot, 'source-checksums.json'), {
    generatedAt,
    specRef: sourceManifest.ref,
    sources: fetchedMetadata
  });
  writeJson(path.join(versionDir, 'operation-manifest.json'), {
    schemaVersion: manifest.schemaVersion,
    generatedAt,
    specRef: manifest.specRef,
    operations: manifest.operations,
    counts: manifest.counts
  });
  writeJson(path.join(versionDir, 'definitions-index.json'), {
    schemaVersion: manifest.schemaVersion,
    generatedAt,
    specRef: manifest.specRef,
    definitions: manifest.definitions
  });
  return { manifest, coverage, fetchedMetadata };
}

export const _internal = {
  readJson,
  writeJson,
  mergeParameters,
  sanitizeKey,
  stableOperationKey,
  tagIsQuarantined,
  inferAction,
  inferBatch,
  classifyOperation
};
