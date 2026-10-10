# SearchAd Local Archive and Mac Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 사용자는 이 ChatGPT가 직접 작업하는 방식을 선택했다. 독립 검토자를 실제 확보하지 못하면 독립 검토 완료라고 기록하지 않는다.

**Goal:** S3 신규 계약 없이 VPS 영구 디스크에 보고서를 보관하고, 24시간 운영 Mac의 10TB 외장디스크에 삭제 비전파 백업과 복구 검증을 제공한다.

**Architecture:** 기존 ingestion의 Customer/hash 기반 put/get 계약을 유지하면서 운영용 로컬 adapter를 별도로 추가한다. VPS exporter는 하나의 PostgreSQL snapshot과 그 snapshot이 참조하는 원본을 완성된 백업 세트로 내보낸다. Mac pull 도구는 제한된 SFTP 읽기 권한으로 세트를 가져와 검증하며, 앱과 백업 스케줄러를 결합하지 않는다.

**Tech Stack:** 기존 Node.js >=22.5.0 / ES modules / node:test / pg, PostgreSQL 16의 pg_dump·pg_restore, Linux 영구 파일시스템, macOS diskutil·launchd, OpenSSH SFTP. 새 npm 운영 의존성은 우선 추가하지 않는다. Mac의 plist 해석은 별도 지정한 Python 3의 표준 plistlib를 사용한다. 도구 설치는 실행 단계에서 격리 환경에만 수행한다.

**Spec:** `docs/superpowers/specs/2026-10-10-searchad-local-storage-mac-backup-design.md` @ `9ca47457527e4ccfd85f563ab14539f3213f053d`. 사용자가 이 대화에서 설계를 승인하여 본 계획을 작성했다. 설계 문서의 '초안' 상태는 작성 당시 기록이며 제품 구현 완료를 뜻하지 않는다.

**Status:** 구현 계획 검토 대기. 제품 코드·운영 설치·새 테스트 실행은 아직 없다. 이 문서의 테스트 이름과 기대 결과는 실행할 계약이지 이미 관측된 결과가 아니다.

## Global Constraints

- 작업 기준 소스는 PR29 `770ece3f2cebe97bd41b82f89f2eb02f710a1c9c`; 작업 브랜치는 `codex/searchad-local-storage-mac-backup-20261010`이다. 계획 작성 직전 브랜치가 설계 commit9ca4745와 동일함을 비교했다.
- PR29/main/PR28은 변경·병합하지 않는다. 구현은 위 분리 브랜치에서 검증하며, 후속 Draft PR/통합은 별도 명시된 단계에서 한다. 병렬 작업의 새 HEAD를 발견하면 덮어쓰지 말고 비교한다.
- 원래0001–0015 migration bytes, sharp 복원, 모든 기존 테스트와 timeout, SearchAd126/runtime117 및 광고 제어 권한 경계를 보존한다.
- 기존 Commerce와 다른 앱의 DB/컨테이너/볼륨은 작업 대상이 아니다. 실제 VPS/Mac 설치, 포맷, 기존 자료 삭제, 계정·키 생성, provider 호출, 광고 게이트 활성화는 승인되지 않았다.
- S3 adapter와 개발용 LocalReportStorage를 보존한다. 기존 클래스의 durableProduction=false를 단순히 true로 바꾸거나 ingestionRequired를 꺼서 우회하지 않는다.
- Mac 백업 지연은 원본 저장과 구분한다. Mac 장애 시 VPS의 안전한 여유 공간 내에서 수집을 계속할 수 있지만 백업 이후 데이터의 무손실을 보장하지 않는다.
- 보고서 최소 보존 정책은 기존 코드의 2*366일을 유지한다. 초기 버전은 원본/완료 백업의 자동 삭제·prune·미러 삭제를 제공하지 않는다. 자신이 만든 임시 파일의 제한된 정리만 허용한다.
- 실제 Customer/키/디스크 UUID/경로/여유 공간은 임의로 넣지 않는다. /Volumes/X9 Pro를 10TB 대상이라고 추정하지 않는다. 10TB는 사용자 제공 전체 용량이지 실제 가용 용량 증거가 아니다.
- 백업/보고서/덤프는 민감한 데이터다. 원문·DB URI·토큰·인증키·임시 URL은 Git, CI artifact, 일반 로그에 넣지 않는다. 상태 로그는 생성한 작업 UUID·고정 코드·카운트만 사용한다.
- 첫 실행은 합성 데이터와 격리 디렉터리/DB에서 한다. CI 결과와 실제 Mac/VPS 운영 자격을 별개로 기록한다.

## Review Focus

1. 정상 저장 ACK 이전의 프로세스 종료/부분 쓰기: 완성된 정본만 노출하고 재실행이 손상 파일을 정상으로 수용하지 않는다 — Tasks1–2.
2. 같은 이름의 다른 외장디스크 또는 mount 제거 후 남은 디렉터리: UUID/device를 확인해 중단하며 내부 SSD에 fallback하지 않는다 — Task5.
3. dump 도중 새 ingestion/격리 기록이 생김: dump와 DB 참조 목록은 같은 snapshot, 새 파일은 누락 없는 추가본일 뿐 새 DB 행으로 오인하지 않는다 — Task4.
4. 스냅샷 수가 늘거나 manifest가 비정상적으로 큼: 해시별 파일 재사용과 스트리밍/상한 검증으로 메모리 폭증·중복 전체 복사를 피하고 용량 부족은 실패로 남긴다 — Tasks4–5.
5. 과거 DB 복구가 이미 소비된 승인 상태를 되돌림: 운영 게이트 OFF와 외부 상태 재조정 전 dispatch 금지, 복원 성공을 실행 승인으로 사용하지 않는다 — Task7.

## 확인한 연결부와 구현 범위

기준의 `reporting/blob-storage.js`는 blobKey/validateBlobKey/blobHash와 개발용 LocalReportStorage를 제공한다. `reporting/runtime.js`는 production ingestion에서 durableProduction 및 generationPolicy를 검사한다. `completion-bootstrap.js`가 현재 s3-storage.js의 configuredReportStorage(env)를 호출하고, 주입 storage는 빌려 쓰며 자체 생성 S3 client만 정리한다. `ReportIngestionService`는 put→get→해시 확인 뒤 DB에 기록하므로 이 순서를 바꾸지 않는다.

새 파일은 두 응집된 묶음으로 나눈다. `src/naver/searchad/reporting/local-*`는 앱의 정본 저장이고, `src/infrastructure/searchad-backup/`는 별도 운영 exporter/pull/검증이다. 후자는 앱의 승인·실행 엔진을 import하지 않는다. 아래 경로는 smartstore-bridge/ 기준이며 .github/만 저장소 루트 기준이다.

| 묶음 | 생성/수정할 주요 파일 | 책임 |
|---|---|---|
| 저장소 | reporting/local-volume.js, local-archive.js, storage-factory.js | mount 검증, 안전한 put/get, 명시적 backend 선택 |
| 앱 연결 | reporting/runtime.js, completion-bootstrap.js, ops/searchad/runtime.env.example | 준비 상태·자원 수명·로컬 설정 템플릿 |
| 백업 공통 | infrastructure/searchad-backup/contracts.js, manifest.js, process-runner.js | 검증 스키마, 제한된 프로세스 실행, 로그 정화 |
| VPS | infrastructure/searchad-backup/postgres-snapshot.js, export-service.js | snapshot과 dump, 완성 세트 발행 |
| Mac | infrastructure/searchad-backup/mac-volume.js, sftp-source.js, pull-service.js | 볼륨 확인, 읽기 전용 전송, 검증 후 완료 |
| 실행/운영 | scripts/searchad-backup-export.mjs, searchad-backup-pull.mjs, searchad-backup-status.mjs; ops/searchad/backup/ | 수동 CLI와 설치하지 않은 스케줄/권한 템플릿 |

## 공통 인터페이스와 설정 결정

기존 `put({customerId,sha256,bytes,contentType,retainUntil}) -> {key,sha256,size}` / `get({customerId,key}) -> Buffer`를 그대로 사용한다. 새 `QualifiedLocalReportStorage.open({root,mountPoint,archiveId,minFreeBytes,clock})`는 async이며 실제 native 검증 뒤 인스턴스를 반환한다. `probe()`는 async, `status()`는 정화된 마지막 검사와 시각, `close()`는 멱등이다. ready/운영 backup qualification은 구분하며 단순 boolean 설정으로 검사를 대신하지 않는다.

새 설정명은 제안된 구현 계약이며 현재 운영값이 아니다:
- ATELIER_SEARCHAD_REPORT_STORAGE: 미설정이면 기존 S3 선택 동작 유지; 명시값은 s3 또는 filesystem.
- ATELIER_SEARCHAD_REPORT_LOCAL_ROOT, ATELIER_SEARCHAD_REPORT_LOCAL_MOUNT, ATELIER_SEARCHAD_REPORT_LOCAL_ARCHIVE_ID: filesystem에서 모두 필수. 절대경로/UUID를 검증한다.
- ATELIER_SEARCHAD_REPORT_LOCAL_MIN_FREE_BYTES: 양의 정수, 기본1073741824. 총 여유 공간은 앞으로 쓸 파일 크기+최소 여유 이상이어야 한다. 이 기본값은 운영 용량 산정이 아니다.
- 로컬 probe는30초 간격, 유효기간60초. 실패·시계 역행·검사 만료 시 ready=false; 복구 후 probe 성공으로만 회복한다. 각 put/get은 별도로 즉시 검증한다.

filesystem 선택과 S3 bucket 설정이 동시에 있으면 설정 충돌로 실패한다. filesystem 오류 때 S3 또는 임시 디렉터리로 fallback하지 않는다. 각 신규 예외는 고정 SEARCHAD_REPORTING_* 또는 SEARCHAD_BACKUP_* 코드와 일반 메시지로 반환한다.

백업 세트 v1은 `<exportRoot>/objects/<customer>/<sha>.tsv`, `<exportRoot>/snapshots/<uuid>/{database.dump,refs.jsonl,objects.jsonl,manifest.json,COMPLETE.json}`이다. objects는 검증된 완성 파일만 추가하며 세트 간 내용 해시로 공유한다. 원본과 export는 별도 복사본이며 원본과 hardlink하지 않는다. COMPLETE는 manifest 파일의 SHA256만 지칭한다. manifest에는 archiveId, snapshotId, DB/schema 식별, sourceCommit, snapshot 시각, migration 목록/checksum, dump/JSONL의 크기·해시·개수만 넣는다. 비밀설정과 raw snapshot token은 제외한다.

JSONL의 DB 참조 레코드는 customerId/blobKey/sha256/sizeBytes/retainUntil이고 sizeBytes는 10진 문자열이다. 중복 Customer/key의 충돌하는 해시/크기는 거부한다. 객체 카탈로그는 동일 키를 한 번만 포함하며 orphan 정본도 보존할 수 있으나 DB 참조 여부를 구분한다. `manifest.json`은1MiB, 각 JSONL행은4096bytes 이하; JSONL은 스트림으로 처리하고 UTF-8 오류/추가 필드/부모경로·절대경로·URL/중복 충돌을 거부한다. 파일 목록 전체를 Buffer로 적재하지 않는다.

### Task 1: 영구 볼륨의 정체성과 준비 상태 검사

**Files:** 생성 `src/naver/searchad/reporting/local-volume.js`, `test/searchad-local-volume.test.js`, `test/helpers/searchad-local-archive-fixture.js`. 수정 `.github/workflows/searchad-extended-cleanup-wip.yml`에 작업 브랜치 push trigger와 이 Task의 집중검사를 추가한다. 기존 trigger/검사/시간 제한은 보존한다.

**Interfaces:** `openLocalVolume({root,mountPoint,archiveId,minFreeBytes,clock}) -> Promise<guard>`; guard는 `check({requiredBytes=0})`, `status()`, `close()`를 제공한다. 운영 v1은 Linux 영구 ext4/xfs만 허용한다. `/proc/self/mountinfo`의 정확한 mount와 정규화된 root/marker `.searchad-archive.json`의 archiveId, dev/inode, 소유권/권한을 확인한다. marker와 mount는 도구가 자동 생성하지 않는다. 정상 앱 계정 이외의 비특권 사용자가 경로를 변경할 수 없어야 하며, root/동일 UID 완전 장악에 대한 불변성은 보장하지 않는다.

- [ ] **RED:** `missing_mount_never_uses_overlay`, `wrong_archive_id_denied`, `symlink_component_denied`, `free_space_reserves_next_write`, `probe_expiry_is_not_ready`를 작성한다. `assert.equal(result.ready,false)`와 오류 코드, fallback 경로 생성0회를 확인한다. native fixture의 정상 mount/marker도 검사한다.
- [ ] **Run RED:** `node --test test/searchad-local-volume.test.js`. missing-module RED 뒤 실제 unsafe volume가 거부되지 않는 행동 RED도 기록한다.
- [ ] **GREEN:** O_NOFOLLOW/디렉터리 fd와 소유권을 검증한다. Linux 디렉터리 fd를 유지하며 허용된 고정 하위 이름만 fd 기준으로 처리한다. mount/dev/inode와 marker를 작업 전후 확인하고 statfs bigint로 공간을 계산한다. overlay/tmpfs/NFS·알 수 없는 filesystem은 거부한다. 필요한 검사를 수행할 수 없는 환경도 실패한다.
- [ ] **Verify:** 위 명령, 생성한 파일의 node --check, `git diff --check`. Linux native runner의 전용 임시 bind mount에서 positive/마운트 소실 negative를 수행한다. 실제 디스크를 포맷하지 않는다.
- [ ] **Commit:** 이 Task 파일만 stage하고 `feat(searchad): qualify explicit local report volumes`.

### Task 2: 중단·동시 쓰기에 안전한 로컬 보고서 정본

**Files:** 생성 `src/naver/searchad/reporting/local-archive.js`, `test/searchad-local-archive.test.js`, `test/helpers/searchad-local-archive-child.mjs`. 기존 blob-storage.js의 Customer/hash 검증을 사용한다.

**Interfaces:** `QualifiedLocalReportStorage.open(...)`; Task1 guard를 소유한다. `durableProduction`은 open의 native 검사가 성공한 인스턴스가 가진 읽기 전용 capability이며 운영 백업 완료의 증거는 아니다. put/get 외에 `probe/status/close`를 제공하고 active I/O를 drain한다.

- [ ] **RED:** `ack_requires_file_and_directory_sync`, `kill_before_publish_exposes_no_blob`, `parallel_identical_puts_converge`, `existing_corruption_is_not_replaced`, `customer_and_symlink_escape_denied`, `full_disk_preserves_previous_blob`. `assert.deepEqual(await storage.get(...),bytes)`, 정본1개, 오염원본 bytes불변, 외부 경로 writes0, 실패 시 성공 ACK0을 검사한다.
- [ ] **Run RED:** `node --test test/searchad-local-archive.test.js`. 프로세스 강제종료 테스트는 child fixture가 자신의 temporary root에서만 수행한다.
- [ ] **GREEN:** Customer 디렉터리는0700, 임시/정본은0600. 같은 디렉터리의 무작위 exclusive 임시 파일에 쓰고 fsync→hash검증→hard-link 기반 no-replace publication→directory fsync 순서로 완성한다. 기존 최종 파일 EEXIST는 실제 size/hash 재검증 뒤에만 성공이다. 실패 때 이미 있는 정본을 unlink/overwrite하지 않는다. 본 호출이 생성한 임시 파일만 정리한다. 디렉터리 fd를 이용해 symlink 교체가 루트 밖 쓰기가 되지 않게 하고 경로 정체성 변경은 ACK를 거부한다. read도 일반파일·크기·해시를 재검증한다.
- [ ] **Verify:** Tasks1–2 + 기존 `node --test test/searchad-report-download.test.js test/searchad-reporting-ingestion.test.js`. 새 child 재시작·동시 put 결과는 실제 실행 숫자로 기록하며 power-cut 전체 내구성 검증이라고 부르지 않는다.
- [ ] **Commit:** `feat(searchad): persist local report blobs without partial publication`.

### Task 3: 실제 bootstrap 연결, S3 호환성과 준비 상태 유지

**Files:** 생성 `src/naver/searchad/reporting/storage-factory.js`, `test/searchad-report-storage-factory.test.js`, `test/postgres-searchad-local-storage.integration.test.js`. 수정 `completion-bootstrap.js`, `reporting/runtime.js`, `ops/searchad/runtime.env.example`, 해당 CI. s3-storage.js와 개발용 LocalReportStorage 동작은 보존한다.

**Interfaces:** `openConfiguredReportStorage(env,{clock}) -> Promise<{storage,close}>`. 기존 configuredReportStorage(env)는 S3 경로로 재사용한다. 주입된 storage는 borrowed이며 종료하지 않는다. 자체 생성 로컬/S3만 정확히 한번 정리하고 중간 bootstrap 실패에도 누수 없이 닫는다.

- [ ] **RED:** `default_s3_selection_unchanged`, `local_config_has_no_fallback`, `required_ingestion_checks_live_local_health`, `borrowed_storage_survives_close`, `native_archive_survives_bootstrap_restart`. 설정 충돌 throw, failed probe 시 runtime ready=false, 재검증 후만 회복, close횟수, 실제 archived bytes를 확인한다.
- [ ] **Run RED:** `node --test test/searchad-report-storage-factory.test.js test/searchad-reporting-runtime.test.js test/postgres-searchad-local-storage.integration.test.js`.
- [ ] **GREEN:** factory await를 실제 storage 선택부에 연결한다. 기존 generationPolicy/production/identity 조건을 보존하고 local health와 결합한다. runtime.status는 캐시 검사 시각을 표시하되 stale검사를 한다. read는 disk full만으로 막지 않고 corruption/mount오류를 거부하며, 신규 쓰기는 부족한 공간에서 실패한다. 백업 지연은 별도 진단이며 storage ready를 가짜 성공으로 만들지 않는다. S3 상태 계약은 그대로 둔다.
- [ ] **Verify:** `postgresCompletionFixture(t)`의 실제 앱/격리 PostgreSQL·fake signed upstream을 재사용해 원본 저장→DB metadata→앱 재구성→원본 읽기를 검증한다. 운영과 같은 mount를 갖춘 native CI가 필수다. #26 cleanup=false, writer/worker/Canary 기본OFF와 타 Customer 거부를 확인한다.
- [ ] **Commit:** `feat(searchad): compose qualified filesystem reporting storage`.

### Task 4: 같은 DB snapshot의 dump·원본 참조·완성 백업 세트

**Files:** 생성 `src/infrastructure/searchad-backup/{contracts,manifest,process-runner,postgres-snapshot,export-service}.js`, `scripts/searchad-backup-export.mjs`, `test/searchad-backup-export.test.js`, `test/postgres-searchad-backup.integration.test.js`.

**Interfaces:** `withBackupSnapshot({pool,schema},task)`는 `{client,snapshotId,migrations,iterateBlobRefs}`를 task에 제공한다. `exportBackup({pool,archive,exportRoot,archiveId,schema,pgDumpPath,pgEnv,clock}) -> {snapshotId,manifestSha256,objectCount}`. `verifyBackupSet({root,snapshotId})`는 스트림으로 hash/refs closure를 검사한다. namespace와 archiveId는 운영 설정이며 HTTP 입력이 아니다.

- [ ] **RED:** `concurrent_ingestion_uses_one_snapshot`, `missing_referenced_blob_prevents_complete`, `duplicate_exports_do_not_duplicate_objects`, `dump_failure_has_no_complete`, `invalid_manifest_path_and_large_record_denied`, `quarantined_and_orphan_archives_are_preserved`. 복원 DB의 blob refs와 refs.jsonl 동등, 2회 export 후 원본객체 수 불변, 누락시 COMPLETE없음, secrets/URI 로그0을 확인한다.
- [ ] **Run RED:** `node --test test/searchad-backup-export.test.js test/postgres-searchad-backup.integration.test.js`.
- [ ] **GREEN:** 전용 backup advisory lock의 단일 owner만 실행한다. READ ONLY REPEATABLE READ transaction에서 pg_export_snapshot() 및 migration metadata/원본 refs를 읽고, exporter transaction을 유지한 채 PostgreSQL16 pg_dump `--format=custom --snapshot=<issued>`를 실행한다. refs는 searchad_report_blobs의 customer_id/blob_key/sha256/size_bytes/retain_until을 사용하고 cursor로 page한다. 예상 current_database/current_schema가 아니면 중단한다. 완료 파일과 격리 파일 모두 DB refs에 포함한다.
- [ ] **GREEN:** pg_dump는 shell 없이 검증한 executable/argv로 호출한다. 비밀 URI를 argv에 넣지 않는다. 지정 PGPASSFILE와 최소 libpq 환경만 전달한다. 운영에서는 PGSSLMODE=verify-full·PGSSLROOTCERT·DNS host를 별도로 검증한다; Node의 NODE_EXTRA_CA_CERTS만으로 pg_dump TLS가 보장된다고 가정하지 않는다. 실패는 일반코드로 남기며 원문stderr는 private0700/0600 진단 안에서만 취급한다.
- [ ] **GREEN:** archive 정본은 순차 stream/hash검사 후 independent content-addressed export copy로 발행한다. DB참조 closure를 만족하고 dump/목록/manifest가 fsync된 뒤 마지막 COMPLETE를 원자 발행한다. 매시간 모든 이전 blob을 다시 복사하지 않는다. 기존완료 세트는 변조·삭제하지 않는다. 도중 crash의 미완성 세트는 재사용해 성공을 가장하지 않고 다음 새 snapshot으로 진행한다.
- [ ] **Verify:** 실제 PG16 두 연결로 snapshot 후 새 행 삽입을 유도한다. 별도 새 테스트 DB에 dump를 복원해 refs/migration/hash를 비교한다. pg_dump/restore16이나 nativeDB가 없으면 acceptance는 NOT_RUN이지 성공이 아니다.
- [ ] **Commit:** `feat(searchad): export consistent database and report backup sets`.

### Task 5: Mac 외장볼륨 보호와 삭제 없는 SFTP pull

**Files:** 생성 `src/infrastructure/searchad-backup/{mac-volume,sftp-source,pull-service}.js`, `scripts/searchad-backup-pull.mjs`, `ops/searchad/backup/read-volume.py`, `test/searchad-mac-volume.test.js`, `test/searchad-backup-pull.test.js`, `test/platform/searchad-mac-backup.native.mjs`.

**Interfaces:** `inspectMacTarget({mountPoint,volumeUuid,subdirectory,pythonPath}) -> checkedTarget`; `SftpBackupSource({host,port,user,identityFile,knownHostsFile,remoteRoot,sftpPath})`는 listCompleted/readFile만 제공한다. `pullBackups({source,target,clock}) -> {copiedSets,verifiedSets,failedSets}`. source의 임의 command/upload/delete는 없다. pure parsing/IO의 주입점은 테스트용 모듈 생성자이며 운영env bypass가 아니다.

**초기 지원 결정:** target은 현재 마운트되어 잠금해제된 암호화 APFS 외장볼륨이다. actual diskutil plist로 UUID·마운트·물리 외장 저장소·암호화 상태를 교차 확인한다. 다른 filesystem/확인 불가 암호화는 TARGET_UNQUALIFIED로 중단하고 기존 자료는 그대로 둔다. 사용자 디스크가 이 조건인지는 미확인이다. 포맷을 요구하거나 자동 수행하지 않는다; 맞지 않으면 자료를 지우지 않는 별도 암호화 컨테이너 지원을 다음 설계로 검토한다.

- [ ] **RED:** `same_name_wrong_uuid_is_denied`, `unmounted_target_never_creates_internal_path`, `disconnect_mid_copy_has_no_complete`, `source_delete_keeps_old_backup`, `resume_verifies_existing_partial_bytes`, `sftp_newline_and_parent_escape_rejected`, `large_manifest_is_streamed`. 내부 SSD 대체폴더 생성0, 정상세트만 완료, 기존백업 bytes불변, 모르는 host-key 거절을 확인한다.
- [ ] **Run RED:** `node --test test/searchad-mac-volume.test.js test/searchad-backup-pull.test.js`.
- [ ] **GREEN:** 절대경로로 지정한 diskutil/Python의 plist 출력만 해석한다. 볼륨 guard가 인정하기 전 mkdir/download를 하지 않는다. 대상경로 components는 symlink거부, open한 root fd/dev/inode 유지와 각 파일 전후 UUID/device 재확인으로 이름 재생성 fallback을 차단한다. 중간 분리 때 파일 fd 오류를 경로 재개방으로 우회하지 않는다.
- [ ] **GREEN:** SFTP는 BatchMode=yes, StrictHostKeyChecking=yes, 전용 UserKnownHostsFile/IdentityFile, IdentitiesOnly=yes 및 shell:false. private temp batch file은0600, 원격경로는 설정root와 검증된 uuid/customer/hash 고정 문법만 조합한다. 부분 다운로드는 target내 staging에만 두고 재검증 후 atomic publication. 서버의 삭제를 따라가지 않는다. 새 키나 known_hosts를 자동 등록하지 않는다.
- [ ] **Verify:** Linux에서 모든 pure/native file-copy 테스트를 수행하고 macOS runner에서 실제 diskutil/plist/권한·internal-volume거부 경로를 검사한다. CI의 임시 테스트 볼륨 결과와 사용자의 실제 외장볼륨 검증을 분리한다. 실제10TB positive qualification은 설치 승인 후 별도 증거가 필요하다.
- [ ] **Commit:** `feat(searchad): pull verified backups without external-volume fallback`.

### Task 6: 실행·상태·스케줄 템플릿과 제한된 권한

**Files:** 생성 `scripts/searchad-backup-status.mjs`, `ops/searchad/backup/{export-config.example.json,mac-config.example.json,searchad-backup.service,searchad-backup.timer,com.haar.searchad-backup.plist,sshd-readonly.example.conf,README.md}`, `test/searchad-backup-ops.test.js`. 수정 ops/searchad/README.md, package.json에 전용 backup:export/pull/status 명령. package-lock은 메타데이터가 실제 변경돼 필요할 때만 갱신한다.

**Interfaces:** `backupStatus({stateDir,clock}) -> {lastAttemptAt,lastSuccessAt,ageMs,code}`. 완료manifest/verified receipt만 성공 근거로 한다. 로그는 UUID/고정코드/개수, 운영 path/credential 값은 출력하지 않는다.

- [ ] **RED:** `hourly_schedule_is_not_installed_by_import`, `overlap_has_one_owner`, `failure_preserves_last_verified_success`, `vps_stays_writable_during_mac_outage`, `backup_user_cannot_write_or_read_secrets`. 템플릿은3600초, 백업성공없으면 NEVER_VERIFIED, 마지막 성공2시간 초과면 BACKUP_OVERDUE, local storage health와 별도인지를 확인한다.
- [ ] **Run RED:** `node --test test/searchad-backup-ops.test.js`.
- [ ] **GREEN:** exporter는 VPS systemd timer, pull은 Mac launchd 템플릿을 제공하되 설치·enable하지 않는다. launchd의 잠자기/재부팅 지연은 catch-up 목록 읽기로 처리한다. 락은 owner PID/프로세스 시작정보와 검증된 target을 묶고 확인 없는 stale lock 강제삭제를 하지 않는다.
- [ ] **GREEN:** SSH의 별도 계정/키에 internal-sftp -R, ChrootDirectory, DisableForwarding, PermitTTY no를 제안한다. root소유 chroot와 export읽기만 갖고 원본/DB/secrets/TLS개인키에는 접근 불가해야 한다. 실제 계정생성·sshd변경은 하지 않는다. read-only임을 실제 격리 OpenSSH 테스트에서 upload/delete/escape로 확인한다.
- [ ] **Verify:** plist/JSON 구조, systemd verify/Bash문법, CLI dry-run과 정상/실패exit코드. 알림전송 주소가 미확인이므로 실제 외부알림은 미설정으로 남기며 '알림 설치 완료'라고 쓰지 않는다.
- [ ] **Commit:** `ops(searchad): document hourly archive backup and read-only access`.

### Task 7: 전체 복원·기존 기능 회귀·운영 인계

**Files:** 생성 `test/postgres-searchad-backup-restore.integration.test.js`, `.github/workflows/searchad-mac-backup.yml`, `docs/SEARCHAD_LOCAL_ARCHIVE_BACKUP_RUNBOOK.md`. 수정 기존 Completion CI에 새 focused 및 full 결과수집, 기존 scanner의 정확히 필요한 reviewed boundary만 갱신한다. storage/scanner 안전장치 전체 directory exclusion은 금지한다.

- [ ] **RED:** `restored_snapshot_has_every_referenced_blob`, `restore_retains_consumed_and_unknown_states`, `missing_blob_or_manifest_tamper_denies_restore_receipt`, `closed_and_unqualified_storage_is_not_ready`. 실제 복원 DB의15 migrationchecksum/행·원본 해시 및 사용된 token/risk/outcome을 검증한다. 원본 접근 불가면 원격 re-download로 조용히 대체하지 않는다.
- [ ] **Run RED:** `node --test test/postgres-searchad-backup-restore.integration.test.js`. source와destination은 test fixture가 만든 고유DB인지 검사하고 기존public/운영schema로 restore하지 않는다.
- [ ] **GREEN:** runbook은 recovery gate OFF로 시작, remote 상태 재조정 전 자동실행 금지를 명시한다. 백업은 DB/보고서 세트이며 역할·시크릿·앱/catalog전체 백업이라고 과장하지 않는다. 복원 도구는 앱을 자동 시작하거나 token을 새로 만들지 않는다.
- [ ] **Verify:** Linux CI는 새 storage/backup native suite를 별도 job으로 두어 기존20분 full-job 시간제한을 늘리지 않는다. 새 job도 Postgres16·외부광고차단 fixture·zero fail/cancel/skip/todo를 필수로 한다. 기존 full suite는 전체 test/*.test.js glob과 concurrency1·기존timeout을 보존한다. 동시 CI jobs는 서로 독립 DB/임시경로만 사용한다. Mac job은 주입 테스트와 native Mac scope를 정확히 구분한다.
- [ ] **Verify:** `npm ci`; `npm run check`; 모든 tracked src/*.js/scripts/*.mjs의 node --check; `TZ=UTC npm test`; `node scripts/searchad-write-safety.mjs`; `node scripts/searchad-execution-safety.mjs`; `npm run searchad:validation:coverage`; `npm run searchad:coverage`; `npm run commerce:coverage`; `git diff --check`; `npm audit --omit=dev --audit-level=high`. argv 실행부의 주입/비밀비노출 회귀를 추가하고 scanner의 기존 pins를 보존한다. 네트워크 차단으로 audit 미실행이면 미검증으로 기록한다.
- [ ] **Verify:** 실제 조회한 HEAD/tree/TAP/hash·실행횟수·미검증 범위로 검증보고를 작성한다. 외부 디스크 물리탈착, VPS 전체장애, 권한배치, 암호화자동잠금해제, 정기실행/알림, 실제 복구시간은 해당장비에서 수행하지 않으면 NOT_RUN으로 남긴다. 녹색 predecessor를 successor검증으로 사용하지 않는다.
- [ ] **Commit:** `test(searchad): verify local archive backup and isolated restore`.

## 실행 순서와 승인 경계

Tasks1→2→3은 앱 로컬정본 저장 증분, Tasks4→5→6은 백업 증분, Task7은 통합검증이다. 각 증분은 TDD와 정확한 commit검증을 끝내고 다음으로 간다. 계획 승인 후 이 ChatGPT가 직접 실행한다. 실제 독립 검토를 얻지 못하면 self-review와 CI까지만 주장한다.

코드 검증이 끝나도 Mac/VPS 설치 완료는 아니다. 운영 전에는 전용 경로·mount/UUID·filesystem/암호화·여유공간, SSH-host-key·제한계정, libpq TLS·백업credential, 실제 정기실행·복원 테스트와 실패 알림경로를 사용자와 확정한다. 예상과 다른 filesystem이 나와도 기존 자료를 포맷하지 않는다. 실제 장비 접속이 안 되는 동안에도 코드/합성테스트 진행을 멈출 필요는 없지만 운영 성공을 주장하지 않는다.

## Self-review 및 근거

계획 self-review: 설계1–3→Global/Tasks1–3; 설계4→Tasks1–3; 설계5→Tasks4–6; 설계6→Task7; 설계7→각Task/CI; 설계8–9→승인경계. 인터페이스명과 파일 책임을 일치시켰고5개 Review Focus의 소유테스트를 배정했다. 운영값 미확인은 입력경계로 남기며 제품요구사항을 임의로 생략하지 않는다. 실제 디스크가 암호화 APFS인지 확인할 수 없다는 제한을 명시했다.

구현자는 다음 공식 문서의 정확한 동작을 다시 확인한다. 이 링크는 API설계의 근거이며 실제 설치/접속검증이 아니다.
- Node22 fs: FileHandle.sync, open/O_NOFOLLOW, link, statfs: https://nodejs.org/docs/latest-v22.x/api/fs.html
- PostgreSQL16 pg_dump --snapshot 및 custom format: https://www.postgresql.org/docs/16/app-pgdump.html
- snapshot발급 transaction이 살아있어야 하는 조건: https://www.postgresql.org/docs/16/functions-admin.html
- OpenSSH read-only SFTP -R: https://man.openbsd.org/sftp-server
- SSH host-key검증 설정: https://man.openbsd.org/ssh_config
- Apple Disk Utility 암호화 절차는 지우기를 수반할 수 있으므로 이 작업에서 실행하지 않음: https://support.apple.com/guide/disk-utility/dskutl35612/mac

이 문서 게시 시에는 계획만 작성했다. 코드변경·새 CI PASS·Mac/VPS설치·백업성공을 의미하지 않는다.
