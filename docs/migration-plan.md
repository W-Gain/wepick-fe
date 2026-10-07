# 프런트엔드 마이그레이션 계획

- 상태: Accepted
- 결정일: 2026-09-13
- 마지막 수정: 2026-09-17
- 대상: `wepick-fe`의 Express·바닐라 JavaScript MPA를 React SPA로 전환
- 기준 브랜치: `dev`
- 상위 계획: [목표 제품 전환 계획](https://github.com/W-Gain/wepick-product/blob/main/docs/plans/2026-09-target-product-transition.md). 진행 상태는 [Product 계획 현황](https://github.com/W-Gain/wepick-product/blob/main/docs/plans/README.md)에서만 관리합니다.
- 위치 이동: 2026-10-07 Product `docs/working/frontend-migration-plan.md`에서 FE 저장소로 이동
- 구현 기준: [ADR-0002 프런트엔드 기술 스택](https://github.com/W-Gain/wepick-product/blob/main/docs/decisions/0002-frontend-technology-stack.md)

## 목표

확정된 모바일 화면을 React + TypeScript + Vite로 구현하고, 현재 BE와 목표 BE를 순서대로 연결합니다. 운영에서는 Express와 별도 FE 실행 서비스를 제거하고 단일 Caddy가 Vite `dist/`와 Spring API를 80/443에서 제공합니다.

기존 HTML·JavaScript·CSS를 파일 단위로 변환하지 않습니다. 화면 정의서를 기준으로 새 앱을 구성하고 다음 기존 자산만 확인 후 가져옵니다.

- 현재 Spring API의 실제 URL·요청·응답과 세션 사용 방식
- 재사용 가능한 제품 이미지와 정적 자산
- 코드 분석에서 확인된 오류·날짜·업로드 제약

기존 게시판 UI, 이메일 인증 UI, Bootstrap 스타일과 Express 화면 route는 새 앱으로 이전하지 않습니다.

## 브랜치와 병합

```text
main                  현재 서비스 가능한 기준
  └─ dev              마이그레이션 통합
      └─ feature/*    한 단계의 구현과 검증
```

- 모든 FE 기능 브랜치는 최신 `dev`에서 만듭니다.
- PR은 단계별 완료 조건을 통과한 뒤 `dev`에 병합합니다.
- `dev`에는 완성 중인 앱이 있을 수 있지만 `main`은 서비스 가능한 상태를 유지합니다.
- 실제 서비스가 가능한 최소 흐름이 완성되기 전에는 `dev`를 `main`에 병합하지 않습니다.
- Product·BE·Infra 변경은 각 저장소의 별도 PR로 만들고 관련 FE PR을 연결합니다.

## 실행 단계

### 0. 계획 확정

**소유:** Product  

작업:

- 이 문서의 단계와 완료 조건 검토 완료
- FE 첫 PR의 범위 확정
- 구현 중 바꾸지 않을 화면·디자인·기술 기준 연결

완료 조건:

- 이 문서가 사용자 검토를 마치고 `Accepted`가 되었습니다.
- 첫 브랜치와 첫 PR 범위가 `1단계`로 고정됩니다.

### 1. React 앱 기반과 빌드

**소유:** FE  
**브랜치:** `feature/fe-app-foundation`, `chore/fe-remove-legacy`  

작업:

- React, TypeScript와 Vite 초기 구성
- React Router Data Mode와 route lazy loading 구성
- TanStack Query, Zod와 공통 `fetch` client 기반 추가
- ESLint, TypeScript 검사, Prettier, Vitest 구성
- `tokens.json`을 기준으로 CSS 의미 토큰과 Tailwind 테마 구성
- 390px 모바일 앱 셸, Light·Dark, safe area 기반 구성
- `/`, `/picks`, `/picks/:pickId`, `/history`, `/profile`, `/profile/edit` 빈 route 연결
- 기존 Express·Bootstrap을 새 앱 실행 경로에서 제거
- Vite `dist/`를 포함하는 Caddy 최종 이미지 생성

이 단계에서는 실제 화면 내용과 API 기능을 구현하지 않습니다.

완료 조건:

- `npm run dev`, 타입 검사, lint, test와 `npm run build`가 통과합니다.
- 직접 URL과 새로고침에서 각 빈 route가 404 없이 열립니다.
- 390×844와 360×800에서 앱 셸이 잘리지 않습니다.
- 운영 이미지에 Node·Express 애플리케이션이 실행되지 않습니다.
- 이미지 안의 `dist/`와 Caddy 정적 제공 구성을 확인합니다.

### 2. Mock 계약과 공통 UI

**소유:** Product·FE  
**브랜치:** `feature/fe-mock-contract`  

작업:

- 화면이 사용하는 Pick, 결과, 의견, 회원, 투표 기록 schema 정의
- 정상·빈 상태·오류 fixture 작성
- MSW 기반 `mock` 모드와 MSW를 사용하지 않는 `real` 모드 분리
- Button, VoteChoice, ResultBar, BottomNav, Dialog, Sheet, Toast와 상태 UI 구현
- Radix의 초점·키보드 동작을 적용하고 외형은 `.pen`과 토큰으로 구현

완료 조건:

- mock과 real 선택이 빌드·실행 설정에 명확하게 드러납니다.
- real 모드의 API 실패가 fixture 성공으로 바뀌지 않습니다.
- 운영 빌드에서 mock worker가 시작되지 않습니다.
- 공통 컴포넌트의 필수 상태를 Light·Dark에서 확인합니다.

### 3. 확정 화면 구현

화면은 아래 순서로 구현하고 각 묶음을 별도 PR로 검토할 수 있습니다.

| 순서 | 브랜치 | 화면·기능 | 검토 기준 |
| ---: | --- | --- | --- |
| 3-1 | `feature/fe-pick-flow` | `SCR-001`, `SCR-003`, 투표 전·후, 결과와 의견 | 공통 Pick UI와 전체 상태 |
| 3-2 | `feature/fe-pick-lists` | `SCR-002`, `SCR-004` | 목록·빈 상태·추가 로딩·상세 이동 |
| 3-3 | `feature/fe-profile` | `SCR-005`, `SCR-006` | 프로필 조회·편집·저장하지 않은 변경 |
| 3-4 | `feature/fe-overlays` | `OVL-001`~`OVL-005` | 로그인·의견·삭제·토스트·탈퇴 동작 |

공통 완료 조건:

- `.pen`과 화면 정의서의 구조·문구·상태를 재현합니다.
- 오늘의 Pick과 Pick 상세가 같은 Pick 컴포넌트를 사용합니다.
- 하단 내비게이션, 뒤로가기와 목록 스크롤 복원이 동작합니다.
- 모바일 viewport와 Light·Dark에서 사용자 검토가 가능합니다.
- 서버 변경이 필요한 행동은 mock에서도 실제 성공한 것처럼 저장하지 않습니다.

### 4. 현재 BE 연결

**소유:** FE·BE  
**브랜치:** `feature/fe-current-api-adapter`

현재 API에서 확인된 범위만 연결합니다.

| 기능 | 처리 |
| --- | --- |
| 오늘의 Pick 조회 | 실제 API 연결 |
| 현재 Topic 기본 목록 | 응답 변환 계층을 거쳐 확인 가능한 필드만 연결 |
| 공유·링크 복사 | 브라우저 기능으로 구현 |
| 현재 회원 프로필·닉네임·이미지 | 개발 세션이 있을 때 연동 검증. 목표 로그인 진입으로 노출하지 않음 |
| 당일 회원 투표 | 개발 세션에서만 계약 검증. 카카오·익명 투표 완성으로 간주하지 않음 |
| 카카오 로그인·익명 투표·지난 Pick 투표·의견·내 기록 | 요청하지 않고 미지원 정보 알림 |
| 회원 탈퇴 | 목표 데이터 정책 확정 전 실제 요청 보류 |

완료 조건:

- 지원 현황표의 실제 연동·부분 지원·미지원 판정과 실행 결과가 일치합니다.
- 화면은 API DTO를 직접 사용하지 않고 화면 model 변환을 거칩니다.
- 현재 API 제약이 목표 UI의 계약으로 굳어지지 않습니다.
- 미지원 행동은 요청과 상태 변경 없이 안내합니다.

### 5. 현재 구조 통합 검증

**소유:** FE·BE·Infra

작업:

- 로컬에서 FE `real` 모드와 현재 Spring·DB 실행
- 오늘 조회, 목록, 개발 세션의 투표와 프로필 연동 확인
- 401·403·404·409·429·5xx와 네트워크 오류 표시 확인
- Caddy 직접 URL, `/api`, `/uploads`, cache와 SPA fallback 검증
- 실행 중 발견한 차이를 목표 ERD·API 설계 입력으로 기록

완료 조건:

- 현재 계약으로 가능한 흐름과 불가능한 흐름이 실행 결과로 구분됩니다.
- `main` 전환 전에 필요한 BE 작업 목록이 확정됩니다.

### 6. 목표 ERD·인증·API 설계

**소유:** Product·BE

작업:

- 카카오 계정 연결, 익명 식별과 로그인 시 투표 병합
- 기존 이메일 회원과 password 데이터 처리
- Pick, 결과, 의견, 공감, 내 기록과 프로필 모델
- 회원 탈퇴의 삭제·익명화·보존과 재가입
- endpoint, 요청·응답, 오류, 권한, 페이지네이션
- 오늘 기준 시간대와 요청 제한

완료 조건:

- ERD와 API 명세가 화면 ID·상태에 연결됩니다.
- migration과 기존 데이터 처리 순서가 명시됩니다.
- 사용자 검토 후 설계 문서가 Accepted가 됩니다.

### 7. 목표 BE와 최종 FE 연결

**소유:** BE·FE

작업:

- BE migration과 카카오·익명 투표·Pick·의견·프로필 API 구현
- 생성 OpenAPI와 테스트로 BE 계약 검증
- FE의 미지원 알림을 실제 API 행동으로 순차 교체
- 카카오 로그인 후 원래 URL·행동·작성 내용 복구
- 목표 범위에서 빠진 기존 UI와 사용하지 않는 adapter 제거

완료 조건:

- 비로그인 투표부터 결과 확인까지 실제 데이터로 완료됩니다.
- 카카오 로그인 후 의견·내 기록·프로필 행동을 완료할 수 있습니다.
- mock은 개발·테스트 용도로만 남고 서비스 흐름이 mock에 의존하지 않습니다.

### 8. 단일 Caddy 전환과 출시 검증

**소유:** Infra·FE·BE

작업:

- Infra Caddy 서비스가 FE 이미지를 사용하도록 변경
- 기존 별도 `frontend` 서비스와 `frontend:3000` 프록시 제거
- Caddy가 `/srv/frontend`의 `dist/`를 직접 제공
- `/api`, `/uploads`, SPA fallback, cache, 압축과 TLS 검증
- FE 이미지 교체 시 health check, 실패 rollback과 짧은 게이트웨이 재시작 확인
- 모바일 Chromium·WebKit 핵심 흐름과 Light·Dark 최종 검증

완료 조건:

- 외부 80/443 외에 FE 포트를 공개하지 않습니다.
- 운영 환경에서 Express와 FE Node runtime이 실행되지 않습니다.
- 핵심 사용자 흐름이 실제 BE·DB에서 통과합니다.
- 실패한 FE 배포를 이전 이미지로 되돌릴 수 있습니다.
- `dev`에서 검증한 서비스 가능 단위를 `main`으로 병합할 수 있습니다.

## PR 공통 검증

모든 FE PR은 다음 검사를 통과해야 합니다.

```text
typecheck → lint → unit/integration test → vite build
```

화면 PR은 영향받는 흐름의 Playwright 테스트와 390×844 Light·Dark 확인을 추가합니다. 시각적 차이는 `.pen`과 화면 정의서를 기준으로 검토하고, 구현 편의를 이유로 Product 문서를 임의로 바꾸지 않습니다.

## 중단과 복구 기준

- 단계가 실패해도 `main`의 기존 서비스는 유지합니다.
- 기반 구성이 불안정하면 다음 화면 PR을 시작하지 않습니다.
- mock과 실제 API 차이를 화면 안의 조건문으로 퍼뜨리지 않고 계약 또는 adapter에서 해결합니다.
- 목표 API 설계가 바뀌면 화면 컴포넌트보다 schema·adapter를 먼저 변경합니다.
- 단일 Caddy 배포가 실패하면 이전 FE 이미지와 이전 Infra 구성을 함께 되돌립니다.
