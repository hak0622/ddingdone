import { FixedBottomCTA, Top } from '@toss/tds-mobile'

interface Props {
  title: string
  subtitle?: string
  onConfirm: () => void
  onInvite?: () => void
}

export default function ResultScreen({ title, subtitle, onConfirm, onInvite }: Props) {
  return (
    <>
      <Top title={<Top.TitleParagraph size={22}> </Top.TitleParagraph>} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 56px - 80px)',
          padding: '0 32px',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: '#3182F6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 8,
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12l5 5L20 7"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#191919',
            margin: 0,
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          {title}
        </p>
        {subtitle && (
          <p
            style={{
              fontSize: 15,
              color: '#8b8b8b',
              margin: 0,
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {onInvite ? (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '12px 20px',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            background: '#fff',
          }}
        >
          <button
            onClick={onInvite}
            style={{
              width: '100%',
              height: 52,
              background: '#3182F6',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            지금 초대하기
          </button>
          <button
            onClick={onConfirm}
            style={{
              width: '100%',
              height: 52,
              background: '#f4f4f4',
              border: 'none',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 400,
              color: '#888888',
              cursor: 'pointer',
            }}
          >
            나중에 할게요
          </button>
        </div>
      ) : (
        <FixedBottomCTA onClick={onConfirm}>확인했어요</FixedBottomCTA>
      )}
    </>
  )
}
