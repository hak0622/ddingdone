# ADR

## ADR-001: Vite + React CSR
이유: 앱인토스는 CSR/SSG 전용. SSR(Next.js) 사용 불가. eval() 금지.

## ADR-002: Firebase (백엔드 서버 없음)
이유: 19일 일정 + 비용 0원. Firebase Realtime DB로 멀티기기 동기화, Storage로 사진 저장.
대안인 GCP Cloud SQL은 유료라 제외.

## ADR-003: Firebase Anonymous Auth
이유: 토스 로그인은 사업자 등록 필요. Anonymous Auth로 UID 발급 → localStorage 닉네임과 매핑.

## ADR-004: supertoss:// 딥링크
이유: 사업자 등록 없이 토스 송금 연결하는 유일한 방법.
리스크: WebView 내부 동작 미확인. Phase 2 step4에서 실기기 검증 필수.
대안: 동작 안 하면 계좌번호 복사 버튼으로 대체.
