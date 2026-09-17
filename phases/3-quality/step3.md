# Step 3: error-boundary

## 읽어야 할 파일

- `src/App.tsx` (라우터 구조 파악)
- `src/components/` 폴더 (기존 컴포넌트 파악)

## 작업

React Error Boundary를 추가하여 예상치 못한 렌더링 에러가 앱 전체를 흰 화면으로 만들지 않도록 한다.

### 1. `src/components/ErrorBoundary.tsx` 생성

React class component 기반 Error Boundary. 함수형 컴포넌트는 Error Boundary를 지원하지 않는다.

```tsx
import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 12,
            padding: '0 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#191919' }}>
            앗, 문제가 생겼어요
          </p>
          <p style={{ fontSize: 14, color: '#888', margin: 0 }}>
            잠시 후 다시 시도해주세요
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              borderRadius: 8,
              background: '#3182F6',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            새로고침
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

### 2. `src/App.tsx` 수정

`ErrorBoundary`로 `BrowserRouter` 전체를 감싼다.

```tsx
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* 기존 라우트 그대로 유지 */}
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
```

## Acceptance Criteria

```bash
npm run test   # 기존 테스트 통과 (회귀 없음)
npm run build  # 컴파일 에러 없이 성공
```

## 검증 절차

1. 최종 AC 커맨드는 Harness가 `index.json`의 `verify` 설정으로 실행한다.
2. 구현을 마치면 `ready_for_verification`과 산출물 summary를 반환한다.
3. Phase/Step 상태와 verify를 수정하거나 Git commit을 실행하지 마라. 최종 판정과 커밋은 Harness가 수행한다.

## 금지사항

- 기존 라우트 구조 변경 금지.
- ErrorBoundary를 함수형 컴포넌트로 구현하지 말 것 (React 제약 사항).
- try/catch로 ErrorBoundary를 대체하지 말 것.
