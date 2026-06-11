@docs/skills/apps-in-toss.md
@docs/skills/tds-mobile.md

# 프로젝트: 띵돈 (ddingdone)

## 기술 스택
- React 18 + Vite (CSR 전용 — SSR 금지, eval() 금지)
- TypeScript strict mode
- @apps-in-toss/web-framework (TDS 컴포넌트 + Bridge API)
- React Router v6
- Zustand
- Firebase Realtime DB + Storage + Anonymous Auth

## 아키텍처 규칙
- CRITICAL: UI는 TDS 컴포넌트 우선. 없을 때만 커스텀.
- CRITICAL: eval(), Function() 사용 금지.
- CRITICAL: 클립보드·공유는 Bridge API만 사용 (@apps-in-toss/web-framework).
- 모임 데이터는 Firebase Realtime DB에 저장.
- 사진은 Firebase Storage에 저장.
- 닉네임은 localStorage. UID는 Firebase Anonymous Auth.
- 모든 화면 상단에 반드시 Top 컴포넌트 사용 (심사 필수).

## 개발 프로세스
- 커밋 메시지는 conventional commits 형식 (feat:, fix:, chore:)
- 새 기능은 테스트 코드 포함

## 명령어
npm run dev      # 개발 서버 (granite dev)
npm run build    # .ait 빌드 (ait build)
npm run lint     # ESLint
