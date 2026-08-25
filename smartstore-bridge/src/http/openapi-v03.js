import { buildOpenApiSpec as buildBaseSpec } from './openapi.js';
import { DRIVE_CONFIRMATIONS } from '../drive/service.js';

function objectResponse(description) {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object' } } }
  };
}

function body(schema, { required = true } = {}) {
  return {
    required,
    content: { 'application/json': { schema } }
  };
}

function driveErrors(spec) {
  return {
    '400': { $ref: '#/components/responses/BadRequest' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '404': { $ref: '#/components/responses/NotFound' },
    '409': { description: '상태 충돌 또는 사용자 OAuth 필요', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    '413': { description: '요청 또는 파일 크기 초과', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    '429': { $ref: '#/components/responses/RateLimited' },
    '502': { description: 'Google Drive API 오류', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    '503': { description: 'Google Drive 연동 또는 쓰기 기능 미설정', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
  };
}

export function buildOpenApiSpec({ serverUrl, version = '0.3.0' }) {
  const spec = buildBaseSpec({ serverUrl, version });
  spec.info.title = 'Atelier Popo SmartStore & Google Drive Bridge API';
  spec.info.description = '아뜰리에포포 스마트스토어 상품 운영과 HAAR Google Drive 루트 내 파일·폴더 전체 쓰기를 제공하는 HTTP API입니다.';
  if (!spec.tags.some(tag => tag.name === 'Drive')) spec.tags.push({ name: 'Drive' });
  const errors = driveErrors(spec);
  const fileId = { $ref: '#/components/parameters/DriveFileId' };

  spec.components.parameters.DriveFileId = {
    name: 'fileId',
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,256}$' }
  };
  spec.components.parameters.DriveFolderId = {
    name: 'folderId',
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,256}$' }
  };
  spec.components.schemas.DriveWriteConfirmation = {
    type: 'string',
    enum: [DRIVE_CONFIRMATIONS.WRITE]
  };
  spec.components.schemas.DriveFile = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      mimeType: { type: 'string' },
      parents: { type: 'array', items: { type: 'string' } },
      trashed: { type: 'boolean' },
      size: { type: ['string', 'null'] },
      md5Checksum: { type: ['string', 'null'] },
      modifiedTime: { type: ['string', 'null'], format: 'date-time' },
      webViewLink: { type: ['string', 'null'] }
    }
  };

  Object.assign(spec.paths, {
    '/api/v1/drive/status': {
      get: {
        operationId: 'getGoogleDriveStatus',
        tags: ['Drive'],
        summary: '서비스 계정, 루트 폴더, 쓰기 기능 설정 상태 확인',
        parameters: [{ name: 'verifyRemote', in: 'query', schema: { type: 'boolean', default: true } }],
        responses: { '200': objectResponse('Drive 상태'), ...errors }
      }
    },
    '/api/v1/drive/capabilities/probe': {
      post: {
        operationId: 'runGoogleDriveWriteCanary',
        tags: ['Drive'],
        summary: 'HAAR 루트 안에서 생성·업로드·교체·이동·복사·휴지통·복원·삭제 쓰기 Canary 실행',
        requestBody: body({
          type: 'object',
          required: ['confirmation'],
          properties: { confirmation: { type: 'string', enum: [DRIVE_CONFIRMATIONS.PROBE] } },
          additionalProperties: false
        }),
        responses: { '200': objectResponse('Canary 결과'), ...errors }
      }
    },
    '/api/v1/drive/catalog/status': {
      get: {
        operationId: 'getGoogleDriveCatalogStatus',
        tags: ['Drive', 'Catalog'],
        summary: 'Drive 카탈로그 manifest와 로컬 캐시 상태 조회',
        responses: { '200': objectResponse('Drive 카탈로그 상태'), ...errors }
      }
    },
    '/api/v1/drive/catalog/sync': {
      post: {
        operationId: 'syncGoogleDriveCatalog',
        tags: ['Drive', 'Catalog'],
        summary: '선택 상품 또는 전체 상품 JSON·이미지를 로컬 캐시로 비동기 동기화',
        requestBody: body({
          type: 'object',
          required: ['idempotencyKey'],
          properties: {
            productIds: {
              type: 'array',
              maxItems: 2000,
              items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }
            },
            includeImages: { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
            limit: { type: 'integer', minimum: 1, maximum: 2000, default: 20 },
            concurrency: { type: 'integer', minimum: 1, maximum: 8, default: 4 },
            idempotencyKey: { $ref: '#/components/schemas/IdempotencyKey' }
          },
          additionalProperties: false
        }),
        responses: {
          '202': objectResponse('동기화 작업 접수'),
          '200': objectResponse('기존 동기화 작업'),
          ...errors
        }
      }
    },
    '/api/v1/drive/cache/cleanup': {
      post: {
        operationId: 'cleanupGoogleDriveCache',
        tags: ['Drive'],
        summary: 'Drive 로컬 캐시에서 TTL이 지난 파일 정리',
        requestBody: body({
          type: 'object',
          properties: {
            maxAgeSeconds: { type: 'integer', minimum: 0, maximum: 2592000 }
          },
          additionalProperties: false
        }, { required: false }),
        responses: { '200': objectResponse('캐시 정리 결과'), ...errors }
      }
    },
    '/api/v1/drive/files': {
      get: {
        operationId: 'searchGoogleDriveFiles',
        tags: ['Drive'],
        summary: 'HAAR 루트 파일 검색 또는 지정 폴더 자식 목록 조회',
        parameters: [
          { name: 'parentId', in: 'query', schema: { type: 'string' } },
          { name: 'query', in: 'query', schema: { type: 'string' } },
          { name: 'mimeType', in: 'query', schema: { type: 'string' } },
          { name: 'rootId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
          { name: 'maxNodes', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50000, default: 5000 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
          { name: 'pageToken', in: 'query', schema: { type: 'string' } },
          { name: 'includeTrashed', in: 'query', schema: { type: 'boolean', default: false } }
        ],
        responses: { '200': objectResponse('검색 결과'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}': {
      get: {
        operationId: 'getGoogleDriveFile',
        tags: ['Drive'],
        summary: 'HAAR 루트 파일 메타데이터 조회',
        parameters: [fileId],
        responses: { '200': objectResponse('파일 정보'), ...errors }
      }
    },
    '/api/v1/drive/folders/{folderId}/children': {
      get: {
        operationId: 'listGoogleDriveFolderChildren',
        tags: ['Drive'],
        summary: '폴더 자식 목록 조회',
        parameters: [
          { $ref: '#/components/parameters/DriveFolderId' },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
          { name: 'pageToken', in: 'query', schema: { type: 'string' } },
          { name: 'includeTrashed', in: 'query', schema: { type: 'boolean', default: false } }
        ],
        responses: { '200': objectResponse('폴더 내용'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/permissions': {
      get: {
        operationId: 'listGoogleDrivePermissions',
        tags: ['Drive'],
        summary: '공유 권한 목록 조회',
        parameters: [fileId],
        responses: { '200': objectResponse('권한 목록'), ...errors }
      },
      post: {
        operationId: 'createGoogleDrivePermission',
        tags: ['Drive'],
        summary: '공유 권한 추가',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          required: ['role', 'confirmation', 'secondConfirmation'],
          properties: {
            type: { type: 'string', enum: ['user', 'group', 'domain', 'anyone'], default: 'user' },
            role: { type: 'string', enum: ['reader', 'commenter', 'writer'] },
            emailAddress: { type: 'string', format: 'email' },
            domain: { type: 'string' },
            allowFileDiscovery: { type: 'boolean' },
            sendNotificationEmail: { type: 'boolean', default: false },
            emailMessage: { type: 'string' },
            confirmation: { type: 'string', enum: [DRIVE_CONFIRMATIONS.PERMISSION] },
            secondConfirmation: { type: 'string', description: '대상 fileId와 동일해야 함' }
          }
        }),
        responses: { '201': objectResponse('생성된 권한'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/download': {
      post: {
        operationId: 'downloadGoogleDriveFileInline',
        tags: ['Drive'],
        summary: '작은 파일을 Base64로 다운로드. Google 문서는 exportMimeType 필요',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          properties: {
            exportMimeType: { type: 'string' },
            maxBytes: { type: 'integer', minimum: 1 }
          }
        }, { required: false }),
        responses: { '200': objectResponse('Base64 파일 내용'), ...errors }
      }
    },
    '/api/v1/drive/folders': {
      post: {
        operationId: 'createGoogleDriveFolder',
        tags: ['Drive'],
        summary: 'HAAR 루트 안에 폴더 생성',
        requestBody: body({
          type: 'object',
          required: ['name', 'confirmation'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            parentId: { type: 'string' },
            confirmation: { $ref: '#/components/schemas/DriveWriteConfirmation' }
          },
          additionalProperties: false
        }),
        responses: { '201': objectResponse('생성된 폴더'), ...errors }
      }
    },
    '/api/v1/drive/native-files': {
      post: {
        operationId: 'createGoogleDriveNativeFile',
        tags: ['Drive'],
        summary: '빈 Google Docs, Sheets 또는 Slides 파일 생성',
        requestBody: body({
          type: 'object',
          required: ['type', 'name', 'confirmation'],
          properties: {
            type: { type: 'string', enum: ['document', 'spreadsheet', 'presentation'] },
            name: { type: 'string', minLength: 1, maxLength: 255 },
            parentId: { type: 'string' },
            confirmation: { $ref: '#/components/schemas/DriveWriteConfirmation' }
          },
          additionalProperties: false
        }),
        responses: { '201': objectResponse('생성된 Google 파일'), ...errors }
      }
    },
    '/api/v1/drive/files/upload': {
      post: {
        operationId: 'uploadGoogleDriveFile',
        tags: ['Drive'],
        summary: '텍스트 또는 Base64 파일 업로드',
        requestBody: body({
          type: 'object',
          required: ['name', 'confirmation'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            parentId: { type: 'string' },
            mimeType: { type: 'string', default: 'application/octet-stream' },
            contentBase64: { type: 'string', contentEncoding: 'base64' },
            text: { type: 'string' },
            confirmation: { $ref: '#/components/schemas/DriveWriteConfirmation' }
          }
        }),
        responses: { '201': objectResponse('업로드된 파일'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/replace': {
      post: {
        operationId: 'replaceGoogleDriveFileContent',
        tags: ['Drive'],
        summary: '기존 파일 내용 교체',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          required: ['confirmation'],
          properties: {
            mimeType: { type: 'string' },
            contentBase64: { type: 'string', contentEncoding: 'base64' },
            text: { type: 'string' },
            confirmation: { $ref: '#/components/schemas/DriveWriteConfirmation' }
          }
        }),
        responses: { '200': objectResponse('교체된 파일'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/rename': {
      post: {
        operationId: 'renameGoogleDriveFile',
        tags: ['Drive'],
        summary: '파일 또는 폴더 이름 변경',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          required: ['name', 'confirmation'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            confirmation: { $ref: '#/components/schemas/DriveWriteConfirmation' }
          }
        }),
        responses: { '200': objectResponse('변경된 파일'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/move': {
      post: {
        operationId: 'moveGoogleDriveFile',
        tags: ['Drive'],
        summary: 'HAAR 루트 안에서 파일 또는 폴더 이동',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          required: ['parentId', 'confirmation'],
          properties: {
            parentId: { type: 'string' },
            confirmation: { type: 'string', enum: [DRIVE_CONFIRMATIONS.MOVE] }
          }
        }),
        responses: { '200': objectResponse('이동된 파일'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/copy': {
      post: {
        operationId: 'copyGoogleDriveFile',
        tags: ['Drive'],
        summary: '파일 복사',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          required: ['confirmation'],
          properties: {
            name: { type: 'string' },
            parentId: { type: 'string' },
            confirmation: { $ref: '#/components/schemas/DriveWriteConfirmation' }
          }
        }),
        responses: { '201': objectResponse('복사된 파일'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/trash': {
      post: {
        operationId: 'trashGoogleDriveItem',
        tags: ['Drive'],
        summary: '파일 또는 폴더를 휴지통으로 이동',
        parameters: [fileId],
        requestBody: body({ $ref: '#/components/schemas/DriveTrashRequest' }),
        responses: { '200': objectResponse('휴지통 이동 결과'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/restore': {
      post: {
        operationId: 'restoreGoogleDriveItem',
        tags: ['Drive'],
        summary: '휴지통 파일 또는 폴더 복원',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          required: ['confirmation', 'secondConfirmation'],
          properties: {
            confirmation: { type: 'string', enum: [DRIVE_CONFIRMATIONS.RESTORE] },
            secondConfirmation: { type: 'string', description: '대상 fileId와 동일해야 함' }
          }
        }),
        responses: { '200': objectResponse('복원 결과'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/delete': {
      post: {
        operationId: 'permanentlyDeleteGoogleDriveItem',
        tags: ['Drive'],
        summary: '파일 또는 폴더 영구 삭제',
        parameters: [fileId],
        requestBody: body({
          type: 'object',
          required: ['confirmation', 'secondConfirmation'],
          properties: {
            confirmation: { type: 'string', enum: [DRIVE_CONFIRMATIONS.DELETE] },
            secondConfirmation: { type: 'string', description: '대상 fileId와 동일해야 함' }
          }
        }),
        responses: { '200': objectResponse('영구 삭제 결과'), ...errors }
      }
    },
    '/api/v1/drive/files/{fileId}/permissions/{permissionId}/delete': {
      post: {
        operationId: 'deleteGoogleDrivePermission',
        tags: ['Drive'],
        summary: '공유 권한 삭제',
        parameters: [
          fileId,
          { name: 'permissionId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: body({
          type: 'object',
          required: ['confirmation', 'secondConfirmation'],
          properties: {
            confirmation: { type: 'string', enum: [DRIVE_CONFIRMATIONS.PERMISSION] },
            secondConfirmation: { type: 'string', description: '대상 permissionId와 동일해야 함' }
          }
        }),
        responses: { '200': objectResponse('권한 삭제 결과'), ...errors }
      }
    },
    '/api/v1/drive/verify-tree': {
      post: {
        operationId: 'verifyGoogleDriveTree',
        tags: ['Drive'],
        summary: 'HAAR 루트 파일·폴더 수와 총 용량 점검',
        requestBody: body({
          type: 'object',
          properties: {
            rootId: { type: 'string' },
            maxNodes: { type: 'integer', minimum: 1, maximum: 200000, default: 20000 }
          }
        }, { required: false }),
        responses: { '200': objectResponse('트리 점검 결과'), ...errors }
      }
    }
  });

  spec.components.schemas.IdempotencyKey = {
    type: 'string',
    minLength: 8,
    maxLength: 128,
    pattern: '^[A-Za-z0-9._:-]+$'
  };

  const asynchronousDriveMutations = [
    '/api/v1/drive/capabilities/probe',
    '/api/v1/drive/folders',
    '/api/v1/drive/native-files',
    '/api/v1/drive/files/upload',
    '/api/v1/drive/files/{fileId}/replace',
    '/api/v1/drive/files/{fileId}/rename',
    '/api/v1/drive/files/{fileId}/move',
    '/api/v1/drive/files/{fileId}/copy',
    '/api/v1/drive/files/{fileId}/trash',
    '/api/v1/drive/files/{fileId}/restore',
    '/api/v1/drive/files/{fileId}/delete',
    '/api/v1/drive/files/{fileId}/permissions',
    '/api/v1/drive/files/{fileId}/permissions/{permissionId}/delete'
  ];
  for (const pathname of asynchronousDriveMutations) {
    const post = spec.paths[pathname].post;
    const schema = post.requestBody.content['application/json'].schema;
    if (!schema.$ref) {
      schema.required = [...new Set([...(schema.required || []), 'idempotencyKey'])];
      schema.properties.idempotencyKey = { $ref: '#/components/schemas/IdempotencyKey' };
    }
    post.responses = {
      '200': objectResponse('기존 Drive 작업'),
      '202': objectResponse('Drive 작업 접수'),
      ...errors
    };
  }

  spec.paths['/api/v1/catalog/enqueue'] = {
    post: {
      operationId: 'enqueueCatalog',
      tags: ['Catalog'],
      summary: '로컬 카탈로그를 원장에 등록. Drive 공급자에서는 JSON 동기화 후 비동기 실행',
      requestBody: body({
        type: 'object',
        properties: {
          idempotencyKey: { $ref: '#/components/schemas/IdempotencyKey' },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
          concurrency: { type: 'integer', minimum: 1, maximum: 8, default: 4 },
          force: { type: 'boolean', default: false }
        },
        additionalProperties: false
      }, { required: false }),
      responses: {
        '200': objectResponse('로컬 원장 등록 또는 기존 비동기 작업'),
        '202': objectResponse('Drive 동기화·원장 등록 작업 접수'),
        ...errors
      }
    }
  };

  spec.components.schemas.DriveTrashRequest = {
    type: 'object',
    required: ['confirmation', 'secondConfirmation', 'idempotencyKey'],
    properties: {
      confirmation: { type: 'string', enum: [DRIVE_CONFIRMATIONS.TRASH] },
      secondConfirmation: { type: 'string', description: '대상 fileId와 동일해야 함' },
      idempotencyKey: { $ref: '#/components/schemas/IdempotencyKey' }
    },
    additionalProperties: false
  };

  return spec;
}
