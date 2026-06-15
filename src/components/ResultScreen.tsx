import { FixedBottomCTA, Top } from '@toss/tds-mobile'

interface Props {
  title: string
  subtitle?: string
  onConfirm: () => void
}

export default function ResultScreen({ title, subtitle, onConfirm }: Props) {
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
      <FixedBottomCTA onClick={onConfirm}>확인했어요</FixedBottomCTA>
    </>
  )
}
