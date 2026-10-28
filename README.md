# ALTER

스스로 생각하고 설명하며 다시 확인하는 개인 학습 공간입니다. Sites v103에 적용한 UI 개편은 iPhone 우선의 오늘·자료·학습·기록·더보기 탐색, 원본 중심 뷰어, 단계별 입력과 저장 상태를 제공합니다. 자료 등록·선택 페이지 판독, 진단·학습계획, 수업·첨삭·복습·주간 점검, Google 연동과 백업·복원의 기존 계약을 유지합니다. 공개 저장소에는 구현·합성 테스트·필수 설정을 보관하며, Task Master 계획·운영 검증 기록과 개인 학습 자료는 비공개로 관리합니다.

## 로컬 실행

Node **24.6.0**, npm **11.x**를 사용합니다. 운영 런타임은 Cloudflare Workers입니다.

```sh
nvm use
npm run install:ci
npm run test:browser:install
npm run dev -- --hostname 127.0.0.1
```

화면 주소는 `http://127.0.0.1:5173`입니다. 의존성은 프로젝트의 `package-lock.json`을 사용하고 Chromium도 `node_modules` 안에 설치합니다. `npm run install:ci`는 공식 Sites 스타터의 설치 helper입니다. Codex에서는 설치된 Sites 플러그인의 `scripts/install-dependencies.mjs`, `scripts/build-site.mjs`를 프로젝트 폴더에서 호출합니다. 다른 패키지 매니저나 별도 빌드 체계를 추가하지 않습니다.

## 검증

```sh
npm run verify
npm run test:failure-gates
```

`verify`는 타입, ESLint, Vitest, 격리된 Miniflare D1·R2, UI 토큰·공통 컴포넌트·탐색 셸·자료 브라우저, Workers 빌드, 산출물 검사, 로컬 DB 마이그레이션 준비, Chromium, 빌드한 Worker 실행을 순서대로 검사합니다. 실패 게이트는 임시 결함을 하나씩 만들고 실제 검사 명령의 비정상 종료를 확인한 뒤 제거합니다. 실행 중에는 소스 파일을 수정하지 않습니다. CI 명령은 [워크플로](.github/workflows/ci.yml)에 있습니다.

산출물 증거는 `outputs/build-verification.json`에 HEAD·작업 트리 변경 여부·소스/lockfile/산출물 해시로 기록합니다. 검사한 코드가 커밋되지 않았다면 HEAD만으로 그 코드를 식별하지 않으며 `sourceDigest`와 파일별 해시를 함께 사용합니다. 비밀값 검사는 알려진 키 패턴과 테스트 표식을 탐지하며 모든 종류의 비밀값 부재를 증명하지는 않습니다.

## 로컬 환경 경계

일반 개발 서버는 모의 인증이 꺼져 있습니다. 인증 기반 작업을 로컬에서 검사할 때만 다음과 같이 명시합니다.

```sh
ALTER_LOCAL_MOCK_AUTH=1 npm run dev -- --hostname 127.0.0.1
```

이때 공식 `/signin-with-chatgpt?return_to=/` 경로에서 테스트 사용자로 로그인할 수 있습니다. 빌드나 관리 환경에서 이 설정을 켜면 오류로 종료합니다. 운영 로그인 경로·헤더 주입은 Sites가 관리하며 앱이 대체 인증 서버를 구현하지 않습니다.

`.openai/hosting.json`의 `DB`·`BUCKET`은 논리적 바인딩 이름입니다. 실제 Sites 리소스 ID나 자격 증명이 아닙니다. 공개 설정의 project_id는 합성 자리표시자입니다. 비공개 배포 전에는 Sites가 발급한 실제 프로젝트 ID를 관리 환경에서 설정해야 하며, 자리표시자로 만든 백업을 운영 복원에 사용하지 않습니다. 개발 서버의 로컬 저장소는 `.wrangler/state`를 사용하고, `test:storage`는 매 실행마다 별도의 일회용 저장소를 생성·정리합니다. 테스트용 테이블은 운영 마이그레이션에 포함하지 않습니다. 인증용 `owner_enrollment` 테이블은 소유자 후보 확인만 저장하며 권한을 부여하지 않습니다. 학습·AI 비용 스키마는 `drizzle/` 마이그레이션으로 관리합니다. `npm run build` 후 `npm run db:preview`로 미리보기 DB에 미적용 SQL만 순서대로 적용하며 브라우저 테스트에서도 이 준비 단계를 실행합니다. 로컬 적용 이력은 파일 해시를 확인하고 중단·변경된 마이그레이션을 자동 재실행하지 않습니다.

`sites()` 빌드 플러그인, Worker 진입점의 요청별 커넥터 연결, 공식 인증 helper를 유지합니다. 공식 스타터에서 가져온 `components/ui`, `scripts/vite`, 실행 helper의 상위 계약을 보존하며 새 코드에는 프로젝트 규칙을 적용합니다. 값이 없는 `.env.example`을 제외한 `.env*`, `.dev.vars*`, `.sites-runtime`, `.wrangler`, 테스트 결과와 빌드는 Git에서 제외합니다.

기존 비공개 Sites v103의 배포 검증 기록과 이후 리뷰 수정의 로컬 검증 결과는 별도로 관리합니다. PR 생성이나 로컬 검증만으로 운영 재배포가 수행되지는 않습니다. 로컬 검사와 브라우저 모바일 에뮬레이션은 실제 서비스나 실제 휴대폰 검증과 구분합니다.

공식 근거: [Sites 관리](https://learn.chatgpt.com/docs/sites/managing-a-site), [Vinext](https://github.com/cloudflare/vinext).
