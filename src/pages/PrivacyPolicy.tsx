import { Top } from '@toss/tds-mobile'

const SECTIONS = [
  {
    title: '1. 수집하는 개인정보 항목',
    body: '띵돈은 서비스 제공을 위해 다음 정보를 수집합니다.\n\n• 닉네임: 이용자가 직접 입력한 이름 (실명 불필요)\n• 모임 사진: 이용자가 선택하여 업로드한 사진 (선택 사항)\n• 지출 내역: 이용자가 입력한 금액, 카테고리, 메모\n• 기기 식별자: 토스 계정 기반 익명 식별 키 (개인을 특정할 수 없음)',
  },
  {
    title: '2. 개인정보 수집 및 이용 목적',
    body: '수집한 정보는 다음 목적으로만 사용합니다.\n\n• 모임별 지출 기록 및 정산 금액 계산\n• 같은 모임 참여자 간 닉네임 표시\n• 앱 재설치·기기 변경 후 데이터 복원',
  },
  {
    title: '3. 개인정보 보유 및 이용 기간',
    body: '이용자가 서비스를 이용하는 동안 데이터를 보유합니다. 서비스 내에서 모임을 직접 삭제하면 해당 모임의 모든 데이터(지출 내역, 사진 포함)가 즉시 삭제됩니다.',
  },
  {
    title: '4. 개인정보 제3자 제공',
    body: '띵돈은 이용자의 개인정보를 외부에 판매하거나 제3자에게 제공하지 않습니다. 단, 서비스 운영을 위해 다음 인프라를 이용합니다.\n\n• Google Firebase (데이터베이스): 모임 정보, 지출 내역 등 데이터는 Firebase 서버에 저장됩니다.\n• Cloudinary (이미지 저장): 이용자가 업로드한 사진은 Cloudinary 서버에 저장됩니다.',
  },
  {
    title: '5. 이용자의 권리',
    body: '이용자는 언제든지 앱 내에서 닉네임을 수정하거나 모임 데이터를 삭제할 수 있습니다. 데이터 삭제 요청은 앱 내 삭제 기능을 통해 직접 처리하실 수 있습니다.',
  },
  {
    title: '6. 문의',
    body: '개인정보 처리에 관한 문의사항은 아래 이메일로 연락해 주세요.\n\nseounghak062@gmail.com',
  },
  {
    title: '부칙',
    body: '이 방침은 2026년 6월 16일부터 적용됩니다.',
  },
]

export default function PrivacyPolicy() {
  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>개인정보처리방침</Top.TitleParagraph>} />
      <div style={{ padding: '20px 20px 48px' }}>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 24px' }}>최종 업데이트: 2026년 6월 16일</p>
        {SECTIONS.map((s) => (
          <div key={s.title} style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#191919', margin: '0 0 8px' }}>{s.title}</p>
            <p style={{ fontSize: 14, color: '#555', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{s.body}</p>
          </div>
        ))}
      </div>
    </>
  )
}
